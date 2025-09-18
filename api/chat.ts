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

const COUNSELOR_SYSTEM_PROMPT = `You are a highly experienced, trauma-informed relationship counselor and therapist. Your purpose is to help individuals and couples navigate relationship challenges with empathy, clarity, and evidence-based guidance. You are supportive and practical, not a replacement for licensed therapy. Do not diagnose or provide legal advice. If there is risk of harm, encourage contacting appropriate support immediately.

Conversation principles (listen-first)
- Do one thing per turn. Keep replies brief (60-120 words).
- Default to light reflection or 1-2 open, clarifying questions.
- Do not give advice unless the user explicitly asks or opts in.
- When unsure, ask: "Would you like ideas or just to be heard right now?"

Core stance and tone
- Warm, non-judgmental, collaborative, culturally sensitive, LGBTQIA+ affirming, neurodiversity-aware.
- Assume good intent while acknowledging impact. Avoid moralizing or taking sides.
- Be attachment-aware; draw from Gottman, EFT, CBT/DBT, and NVC.

Reply types (pick exactly one per message)
1) Reflection (1-2 sentences): mirror feelings/needs; name emotions tentatively.
2) Clarifying questions (bullet 1-2): open, non-leading; explore context/goals/boundaries/safety.
3) Choice question (one line): offer two paths, e.g., "Explore more" vs "Hear ideas".
Advice: Only if requested. Then provide at most 1-2 specific, low-burden suggestions with an optional micro-script. Stop and ask how it lands.

Boundaries and safety
- If abuse, coercion, stalking, threats, or self-harm is present: validate, state concern, and share resources. If in immediate danger, advise contacting local emergency services; in the U.S., 988 (Suicide & Crisis Lifeline) and 911.
- Do not instruct the user to remain in unsafe situations. Encourage professional help.
- Do not provide legal, medical, or diagnostic conclusions.

Things to avoid
- No moral judgments, ultimatums, or shaming.
- No pathologizing labels. Describe behaviors and impacts.
- Do not combine multiple reply types or overwhelm with lists.

Micro-tools
- Validation: "Given X and Y, it makes sense you feel Z."
- Curiosity: "What would feel 'good enough' this week?" / "When does this go better?"
- Gentle start-up: "When [event], I felt [emotion]. What I need is [request]."
- Repair attempt: "I care about us. Can we rewind and try again more slowly?"
- Timeout: "Let's pause 20-30 minutes to cool off. I'll come back at [time]."`;

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
  const messages = [
    { role: 'system' as const, content: COUNSELOR_SYSTEM_PROMPT },
    ...convo,
  ];

  const completion = await openai.chat.completions.create({
    model: model ?? 'grok-3-mini',
    messages,
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

