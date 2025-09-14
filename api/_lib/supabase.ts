import type { VercelRequest } from "@vercel/node";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;

export type User = {
  id: string;
  email?: string | null;
};

export function getBearerTokenFromRequest(req: VercelRequest): string | null {
  const authHeader = req.headers["authorization"] || req.headers["Authorization"]; // Node may lowercase
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice("Bearer ".length);
  }
  const supabaseHeader = req.headers["x-supabase-auth"]; // custom header if client cannot set Authorization
  if (typeof supabaseHeader === "string" && supabaseHeader.length > 0) {
    return supabaseHeader;
  }
  const cookie = req.headers["cookie"] as string | undefined;
  if (cookie) {
    const match = cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("sb-access-token="));
    if (match) {
      return decodeURIComponent(match.split("=")[1] || "");
    }
  }
  return null;
}

export function createSupabaseClientForUserToken(
  accessToken: string | null
): SupabaseClient {
  const headers: Record<string, string> = {};
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers,
    },
  });
}

export function createServiceRoleClient(): SupabaseClient | null {
  if (!SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getUserFromRequest(req: VercelRequest): Promise<User | null> {
  const token = getBearerTokenFromRequest(req);
  if (!token) return null;
  const supabase = createSupabaseClientForUserToken(token);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email };
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

