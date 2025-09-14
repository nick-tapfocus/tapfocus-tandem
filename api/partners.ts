import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { handleCors } from "./_lib/cors";
import {
  createServiceRoleClient,
  createSupabaseClientForUserToken,
  getBearerTokenFromRequest,
} from "./_lib/supabase";

const connectSchema = z.object({
  partnerId: z.string().uuid().optional(),
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;

  const token = getBearerTokenFromRequest(req);
  const supabase = createSupabaseClientForUserToken(token);
  const { data: authData } = token
    ? await supabase.auth.getUser(token)
    : { data: { user: null } };
  const userId = authData?.user?.id ?? null;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("profiles")
      .select("partner_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(200).json({ partnerId: data?.partner_id ?? null });
    return;
  }

  if (req.method === "POST") {
    const parsed = connectSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid payload", details: parsed.error.issues });
      return;
    }
    const partnerId = parsed.data.partnerId;
    if (!partnerId) {
      res.status(400).json({ error: "Missing partnerId" });
      return;
    }

    // Ensure current user has no partner and partner has no partner
    const { data: selfProfile, error: selfErr } = await supabase
      .from("profiles")
      .select("partner_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (selfErr) return res.status(500).json({ error: selfErr.message });
    if (selfProfile?.partner_id) return res.status(400).json({ error: "You already have a partner" });

    const { data: partnerProfile, error: partnerErr } = await supabase
      .from("profiles")
      .select("partner_id")
      .eq("user_id", partnerId)
      .maybeSingle();
    if (partnerErr) return res.status(500).json({ error: partnerErr.message });
    if (partnerProfile?.partner_id) return res.status(400).json({ error: "Partner already linked" });

    // Try to set both sides if service role is available; otherwise set current user's side
    const service = createServiceRoleClient();
    if (service) {
      const { error } = await service.rpc("link_partners", { a: userId, b: partnerId });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true, partnerId });
    } else {
      const { error } = await supabase
        .from("profiles")
        .update({ partner_id: partnerId })
        .eq("user_id", userId);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true, partnerId, note: "One-sided link set; awaiting partner" });
    }
  }

  if (req.method === "DELETE") {
    const service = createServiceRoleClient();
    if (service) {
      const { error } = await service.rpc("unlink_partner", { a: userId });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    } else {
      const { error } = await supabase
        .from("profiles")
        .update({ partner_id: null })
        .eq("user_id", userId);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}

