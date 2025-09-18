-- Enable extensions as needed
create extension if not exists "pgcrypto";

-- ==============================================
-- DANGER: DEV RESET - Drop app tables (idempotent)
-- Run as-is to reset your public schema app tables
-- ==============================================
do $$
begin
  -- Drop in dependency order (children first)
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'messages') then
    execute 'drop table if exists public.messages cascade';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'chats') then
    execute 'drop table if exists public.chats cascade';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'chat_messages') then
    execute 'drop table if exists public.chat_messages cascade'; -- legacy
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'test_results') then
    execute 'drop table if exists public.test_results cascade';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'profiles') then
    execute 'drop table if exists public.profiles cascade';
  end if;
end $$;

-- Basic profiles table to track partner relationships
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  partner_id uuid references public.profiles(user_id) on delete set null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create unique index if not exists profiles_user_id_idx on public.profiles(user_id);
create index if not exists profiles_partner_id_idx on public.profiles(partner_id);

-- Ensure only one partner at a time via constraint and helper functions
create or replace function public.link_partners(a uuid, b uuid)
returns void
language plpgsql
security definer
as $$
begin
  if a = b then
    raise exception 'Cannot partner with yourself';
  end if;
  -- Ensure rows exist
  insert into public.profiles(user_id) values (a)
  on conflict (user_id) do nothing;
  insert into public.profiles(user_id) values (b)
  on conflict (user_id) do nothing;

  -- Ensure neither has a partner
  if exists (select 1 from public.profiles where user_id = a and partner_id is not null) then
    raise exception 'User already has a partner';
  end if;
  if exists (select 1 from public.profiles where user_id = b and partner_id is not null) then
    raise exception 'Partner already linked';
  end if;

  update public.profiles set partner_id = b, updated_at = now() where user_id = a;
  update public.profiles set partner_id = a, updated_at = now() where user_id = b;
end;
$$;

create or replace function public.unlink_partner(a uuid)
returns void
language plpgsql
security definer
as $$
declare
  b uuid;
begin
  select partner_id into b from public.profiles where user_id = a;
  update public.profiles set partner_id = null, updated_at = now() where user_id = a;
  if b is not null then
    update public.profiles set partner_id = null, updated_at = now() where user_id = b;
  end if;
end;
$$;

-- Legacy chat_messages table removed in favor of normalized chats/messages

-- Test results
create table if not exists public.test_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  test_id text not null,
  answers jsonb not null,
  score integer not null,
  percentile integer not null,
  summary text,
  created_at timestamp with time zone default now()
);

create index if not exists test_results_user_id_idx on public.test_results(user_id);

-- RLS policies
alter table public.profiles enable row level security;
-- legacy RLS entries removed
alter table public.test_results enable row level security;

-- Profiles policies
create policy "read own profile" on public.profiles
  for select using (auth.uid() = user_id);

create policy "update own profile" on public.profiles
  for update using (auth.uid() = user_id);

create policy "insert own profile" on public.profiles
  for insert with check (auth.uid() = user_id);

-- legacy policies removed

-- Auto-create a profile row for every new auth user
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- Backfill any missing profiles for existing users (idempotent)
insert into public.profiles(user_id)
select u.id from auth.users u
left join public.profiles p on p.user_id = u.id
where p.user_id is null
on conflict (user_id) do nothing;

-- New chat model: chats and messages (normalized)

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamp with time zone default now()
);

alter table public.chats enable row level security;

drop policy if exists "read own chats" on public.chats;
create policy "read own chats" on public.chats
  for select using (auth.uid() = user_id);

drop policy if exists "insert own chats" on public.chats;
create policy "insert own chats" on public.chats
  for insert with check (auth.uid() = user_id);

create index if not exists chats_user_id_idx on public.chats(user_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  analysis jsonb,
  created_at timestamp with time zone default now()
);

alter table public.messages enable row level security;

-- Users can read/insert messages only within their own chats
drop policy if exists "read own messages" on public.messages;
create policy "read own messages" on public.messages
  for select using (
    exists(select 1 from public.chats c where c.id = chat_id and c.user_id = auth.uid())
  );

drop policy if exists "insert own messages" on public.messages;
create policy "insert own messages" on public.messages
  for insert with check (
    exists(select 1 from public.chats c where c.id = chat_id and c.user_id = auth.uid())
  );

create index if not exists messages_chat_id_idx on public.messages(chat_id);
create index if not exists messages_user_id_idx on public.messages(user_id);

-- Realtime publication and replication settings (idempotent)
-- Ensure messages table is part of supabase_realtime publication
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end $$;

-- Ensure UPDATEs emit full row (so Realtime has primary key on update)
alter table public.messages replica identity full;

-- Test policies
create policy "read own tests" on public.test_results
  for select using (auth.uid() = user_id);

create policy "insert own tests" on public.test_results
  for insert with check (auth.uid() = user_id);

