-- Enable extensions as needed
create extension if not exists "pgcrypto";

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

-- Chat logs
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  messages jsonb not null,
  reply text not null,
  model text,
  created_at timestamp with time zone default now()
);

create index if not exists chat_messages_user_id_idx on public.chat_messages(user_id);

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
alter table public.chat_messages enable row level security;
alter table public.test_results enable row level security;

-- Profiles policies
create policy "read own profile" on public.profiles
  for select using (auth.uid() = user_id);

create policy "update own profile" on public.profiles
  for update using (auth.uid() = user_id);

create policy "insert own profile" on public.profiles
  for insert with check (auth.uid() = user_id);

-- Chat policies
create policy "read own chat" on public.chat_messages
  for select using (auth.uid() = user_id);

create policy "insert own chat" on public.chat_messages
  for insert with check (auth.uid() = user_id);

-- Test policies
create policy "read own tests" on public.test_results
  for select using (auth.uid() = user_id);

create policy "insert own tests" on public.test_results
  for insert with check (auth.uid() = user_id);

