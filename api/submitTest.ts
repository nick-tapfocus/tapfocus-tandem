import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { handleCors } from "./_lib/cors";
import { createServiceRoleClient, createSupabaseClientForUserToken, getBearerTokenFromRequest } from "./_lib/supabase";
import { getTestDefinition, getDefaultTest } from "./_lib/questions";

const submitSchema = z.object({
  testId: z.string().optional(),
  answers: z
    .array(
      z.object({
        questionId: z.string(),
        value: z.number().int().min(1).max(5),
      })
    )
    .min(1),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const parse = submitSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: "Invalid payload", details: parse.error.issues });
    return;
  }

  const { testId, answers } = parse.data;
  const test = testId ? getTestDefinition(testId) : getDefaultTest();
  if (!test) {
    res.status(404).json({ error: "Test not found" });
    return;
  }

  const maxScore = test.questions.length * 5;
  const total = answers.reduce((acc, a) => acc + a.value, 0);
  const percentile = Math.round((total / maxScore) * 100);

  const style = classifyCommunicationStyle(answers);
  const summary = `Your responses suggest a ${style.primary} style with ${style.secondary} tendencies. You scored ${total}/${maxScore} (${percentile}%).`;

  const token = getBearerTokenFromRequest(req);
  const supabase = createSupabaseClientForUserToken(token);

  let userId: string | null = null;
  if (token) {
    const { data } = await supabase.auth.getUser(token);
    userId = data.user?.id ?? null;
  }

  if (userId) {
    const serviceClient = createServiceRoleClient() ?? supabase;
    const { error } = await serviceClient
      .from("test_results")
      .insert({
        user_id: userId,
        test_id: test.id,
        answers,
        score: total,
        percentile,
        summary,
      });
    if (error) {
      // Non-fatal: continue to return result
      console.error("Failed to store test result:", error);
    }
  }

  res.status(200).json({
    result: {
      testId: test.id,
      score: total,
      percentile,
      style,
      summary,
    },
  });
}

function classifyCommunicationStyle(
  answers: { questionId: string; value: number }[]
): { primary: string; secondary: string } {
  type BucketKey = "direct" | "empathetic" | "analytical" | "adaptive";
  const buckets: Record<BucketKey, number> = {
    direct: 0, // q1,q5,q9
    empathetic: 0, // q2,q6
    analytical: 0, // q3,q7,q10
    adaptive: 0, // q4,q8
  };
  const map: Record<string, BucketKey> = {
    q1: "direct",
    q5: "direct",
    q9: "direct",
    q2: "empathetic",
    q6: "empathetic",
    q3: "analytical",
    q7: "analytical",
    q10: "analytical",
    q4: "adaptive",
    q8: "adaptive",
  };
  for (const a of answers) {
    const k: BucketKey | undefined = map[a.questionId];
    if (k) buckets[k] += a.value;
  }
  const sorted = Object.entries(buckets).sort((a, b) => b[1] - a[1]);
  const primary = label(sorted[0]?.[0]);
  const secondary = label(sorted[1]?.[0]);
  return { primary, secondary };
}

function label(key?: string): string {
  switch (key) {
    case "direct":
      return "Direct";
    case "empathetic":
      return "Empathetic";
    case "analytical":
      return "Analytical";
    case "adaptive":
      return "Adaptive";
    default:
      return "Balanced";
  }
}

