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

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string(),
      })
    )
    .min(1),
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
  let userId: string | null = null;
  if (token) {
    const { data } = await supabase.auth.getUser(token);
    userId = data.user?.id ?? null;
  }

  const { messages, model } = parse.data;
  const completion = await openai.chat.completions.create({
    model: model ?? "grok-2-latest",
    messages,
    temperature: 0.7,
  });
  const reply = completion.choices[0]?.message?.content ?? "";

  // Store conversation (sent + received). Use service role if available to ensure persistence even when unauthenticated.
  const writer = createServiceRoleClient() ?? supabase;
  const { error: storeError } = await writer.from("chat_messages").insert({
    user_id: userId ?? null,
    messages,
    reply,
    model: completion.model,
  });
  if (storeError) console.error("Failed to store chat message:", storeError);

  res.status(200).json({ reply, model: completion.model });
}

