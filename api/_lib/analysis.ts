import OpenAI from 'openai';
import { requireEnv } from './supabase';

export type AngerAnalysis = { anger: number };

export async function analyzeAnger(messages: { role: string; content: string }[]): Promise<AngerAnalysis> {
  const openai = new OpenAI({ apiKey: requireEnv('XAI_API_KEY'), baseURL: 'https://api.x.ai/v1' });
  const userText = messages.filter(m => m.role === 'user').map(m => m.content).join('\n');
  const systemPrompt = [
    'You are a strict JSON-only analyzer. Analyze the provided message for anger on a 1-5 scale.',
    'Rules:',
    '- Output ONLY a single JSON object with one key: "anger".',
    '- The value must be an integer from 1 (no anger) to 5 (very angry).',
    '- No prose or explanation, only JSON.',
  ].join('\n');
  const completion = await openai.chat.completions.create({
    model: 'grok-3-mini',
    temperature: 0,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Message:\n${userText}\nRespond with JSON only.` },
    ],
  });
  const content = completion.choices[0]?.message?.content ?? '{}';
  try {
    const parsed = JSON.parse(content);
    const anger = Math.max(1, Math.min(5, Number(parsed?.anger ?? 1)));
    return { anger };
  } catch {
    return { anger: 1 };
  }
}


