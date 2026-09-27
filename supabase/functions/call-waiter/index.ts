// POST /functions/v1/call-waiter
// API Specification §10.1 — App Flow §3.6
//
// Auth: any signed-in registered session participant. waiter_calls' own RLS
// already permits a participant to insert directly (for all, scoped via
// current_participant_session_ids()), but this project's convention wraps
// every diner-facing mutation in an Edge Function regardless (join-session,
// scan-qr, place-order) — kept here too so table_id is resolved server-side
// from the session rather than trusted from the client, which doesn't
// necessarily have it cached at this point in the flow.

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
  const body = rawBody as Record<string, unknown>;

  const sessionId = body?.session_id;
  if (typeof sessionId !== "string" || sessionId === "") {
    return errorResponse("MISSING_REQUIRED_FIELD", "Missing or invalid field: session_id", 400);
  }
  const reason = body?.reason;
  if (reason !== undefined && reason !== null && typeof reason !== "string") {
    return errorResponse("MISSING_REQUIRED_FIELD", "Invalid field: reason", 400);
  }

  // Caller must actually be a participant of this session — same pattern as
  // place-order's participant check.
  const { data: participant, error: participantError } = await admin
    .from("session_participants")
    .select("id")
    .eq("session_id", sessionId)
    .eq("user_id", callerId)
    .maybeSingle();
  if (participantError || !participant) {
    return errorResponse("FORBIDDEN", "Caller is not a participant of this session", 403);
  }

  const { data: session, error: sessionError } = await admin
    .from("table_sessions")
    .select("id, table_id, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError || !session || session.status !== "open") {
    return errorResponse("SESSION_NOT_OPEN", "Cannot call a server for a closed table", 409);
  }

  const { data: waiterCall, error: insertError } = await admin
    .from("waiter_calls")
    .insert({
      session_id: sessionId,
      table_id: session.table_id,
      reason: (reason as string | null) ?? null,
    })
    .select("id, status, created_at")
    .single();

  if (insertError || !waiterCall) {
    console.error("call-waiter insert failed", insertError);
    return errorResponse("INTERNAL_ERROR", "Failed to call a server", 500);
  }

  return jsonResponse({ waiter_call: waiterCall }, 201);
});
