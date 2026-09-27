// POST /functions/v1/close-session
// API Specification §6.3 — Backend Schema §4
//
// Auth: the session's host participant, or staff of the owning restaurant.
// Closes the table_session once every payment share for it is settled, and
// frees the table back to 'available'.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.4";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function errorResponse(code: string, message: string, status: number) {
  return jsonResponse({ error: { code, message } }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST is supported", 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return errorResponse("UNAUTHENTICATED", "Missing bearer token", 401);
  }
  const token = authHeader.slice("Bearer ".length);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) {
    return errorResponse("UNAUTHENTICATED", "Invalid or expired token", 401);
  }
  const callerId = userData.user.id;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse("MISSING_REQUIRED_FIELD", "Request body must be valid JSON", 400);
  }
  const sessionId = (rawBody as Record<string, unknown>)?.session_id;
  if (typeof sessionId !== "string" || sessionId === "") {
    return errorResponse("MISSING_REQUIRED_FIELD", "Missing or invalid field: session_id", 400);
  }

  const { data: session, error: sessionError } = await admin
    .from("table_sessions")
    .select("id, table_id, restaurant_id, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError || !session) {
    return errorResponse("NOT_FOUND", "Session not found", 404);
  }

  // Authorization is checked before anything else, including the
  // already-closed short-circuit below — an unrelated caller must get the
  // same FORBIDDEN either way, not a free 200 just because there happens to
  // be nothing left to change.
  const { data: hostRow } = await admin
    .from("session_participants")
    .select("id")
    .eq("session_id", sessionId)
    .eq("user_id", callerId)
    .eq("is_host", true)
    .maybeSingle();

  const { data: staffRow } = await admin
    .from("staff")
    .select("id")
    .eq("user_id", callerId)
    .eq("restaurant_id", session.restaurant_id)
    .eq("is_active", true)
    .maybeSingle();

  if (!hostRow && !staffRow) {
    return errorResponse("FORBIDDEN", "Only the host participant or restaurant staff can close this session", 403);
  }

  if (session.status === "closed") {
    return jsonResponse({ status: "closed", closed_at: null }, 200);
  }

  const { data: unpaidShares } = await admin
    .from("payment_participant_shares")
    .select("id, payments!inner(session_id)")
    .eq("payments.session_id", sessionId)
    .eq("status", "pending")
    .limit(1);

  if (unpaidShares && unpaidShares.length > 0) {
    return errorResponse("UNPAID_SHARES_EXIST", "Not every participant has paid their share yet", 409);
  }

  const closedAt = new Date().toISOString();
  const { error: closeError } = await admin
    .from("table_sessions")
    .update({ status: "closed", closed_at: closedAt })
    .eq("id", sessionId);
  if (closeError) {
    console.error("close-session update failed", closeError);
    return errorResponse("INTERNAL_ERROR", "Failed to close session", 500);
  }

  await admin.from("tables").update({ status: "available" }).eq("id", session.table_id);

  return jsonResponse({ status: "closed", closed_at: closedAt }, 200);
});
