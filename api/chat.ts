import type { VercelRequest, VercelResponse } from "@vercel/node";
import OpenAI from "openai";
import { z } from "zod";
import { handleCors } from "./_lib/cors";
import {
  createSupabaseClientForUserToken,
  getBearerTokenFromRequest,
  requireEnv,
} from "./_lib/supabase";
import { createServiceRoleClient } from "./_lib/supabase";
import { analyzeAnger } from "./_lib/analysis";

const bodySchema = z.object({
  chatId: z.string().uuid().optional(),
  content: z.string().min(1),
  model: z.string().optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const parse = bodySchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid payload", details: parse.error.issues });
    return;
  }

  const openai = new OpenAI({
    apiKey: requireEnv("XAI_API_KEY"),
    baseURL: "https://api.x.ai/v1",
  });

  const token = getBearerTokenFromRequest(req);
  const supabase = createSupabaseClientForUserToken(token);
  const { data: userData } = token ? await supabase.auth.getUser(token) : { data: { user: null } } as any;
  const userId: string | null = userData?.user?.id ?? null;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  console.log('[chat] userId', userId);

  const { chatId: incomingChatId, content, model } = parse.data;

  // Ensure a chat exists for this user
  const service = createServiceRoleClient();
  const writer = service ?? supabase;
  console.log('[chat] usingServiceRole', !!service);
  let chatId = incomingChatId ?? null;
  if (chatId) {
    const { data: c, error: cErr } = await supabase.from('chats').select('id,user_id').eq('id', chatId).maybeSingle();
    if (cErr || !c || c.user_id !== userId) {
      // Reset to new chat if invalid or not owned by user
      chatId = null;
    }
  }
  if (!chatId) {
    const { data: chatRow, error: chatErr } = await writer.from('chats').insert({ user_id: userId }).select('id').single();
    if (chatErr || !chatRow?.id) {
      res.status(500).json({ error: chatErr?.message || 'Failed to create chat' });
      return;
    }
    chatId = chatRow.id as string;
  }
  console.log('[chat] active chatId', chatId);

  // Insert user message
  const { data: userMsg, error: umErr } = await writer
    .from('messages')
    .insert({ chat_id: chatId, user_id: userId, role: 'user', content })
    .select('id')
    .single();
  if (umErr || !userMsg?.id) {
    res.status(500).json({ error: umErr?.message || 'Failed to store user message' });
    return;
  }
  const userMessageId = userMsg.id as string;
  console.log('[chat] stored userMessageId', userMessageId);

  // Start analysis immediately (do not wait for assistant)
  ;(async () => {
    try {
      console.log('[chat] analysis start', { userMessageId });
      const analysis = await analyzeAnger([{ role: 'user', content }]);
      const { error: upErr } = await writer.from('messages').update({ analysis }).eq('id', userMessageId);
      if (upErr) console.error('[chat] analysis update failed', upErr);
      else console.log('[chat] analysis updated', { userMessageId, analysis });
    } catch (e) {
      console.error('Analysis failed', e);
    }
  })();

  // Build context from last N messages in this chat
  const { data: history } = await supabase
    .from('messages')
    .select('role,content')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true })
    .limit(30);
  const convo = (history ?? []).map((m: any) => ({ role: m.role as 'user'|'assistant'|'system', content: m.content as string }));

  const completion = await openai.chat.completions.create({
    model: model ?? 'grok-3-mini',
    messages: convo,
    temperature: 0.7,
  });
  const reply = completion.choices[0]?.message?.content ?? '';

  // Insert assistant message
  const { data: asstMsg, error: amErr } = await writer
    .from('messages')
    .insert({ chat_id: chatId, user_id: userId, role: 'assistant', content: reply })
    .select('id')
    .single();
  if (amErr) console.error('Failed to store assistant message:', amErr);
  else console.log('[chat] stored assistantMessageId', asstMsg?.id);

  // (analysis already kicked off above)

  res.status(200).json({
    reply,
    model: completion.model,
    chatId,
    userMessageId,
    assistantMessageId: asstMsg?.id ?? null,
  });
}

