import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleCors } from "./_lib/cors";
import { getDefaultTest, getTestDefinition } from "./_lib/questions";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  const method = req.method || "GET";
  if (method !== "GET" && method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const testId =
    (method === "GET" ? (req.query.testId as string | undefined) : undefined) ||
    (typeof req.body?.testId === "string" ? req.body.testId : undefined) ||
    undefined;

  const test = testId ? getTestDefinition(testId) : getDefaultTest();
  if (!test) {
    res.status(404).json({ error: "Test not found" });
    return;
  }
  res.status(200).json({ test });
}

