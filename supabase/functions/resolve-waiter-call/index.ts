// POST /functions/v1/resolve-waiter-call
// API Specification §10.2 — Backend Schema §8.2-8.3, PRD §5.1.4
//
// Auth: Bearer token, caller must be an ACTIVE staff member with
// role='waiter' for the restaurant this call belongs to — explicitly not
// manager, not kitchen, not "any staff" (PRD §5.1.4: "לא לכל הצוות ולא רק
// למנהל"). service_role bypasses RLS, so this check is explicit here,
// mirroring invite-staff/index.ts's own role check (there: manager; here:
// waiter). The matching RLS policy (waiter_resolve_own_restaurant_
// waiter_calls, 20261011090000) enforces the same restriction for any
// direct PostgREST call that bypasses this function.
//
// Sets status='resolved', resolved_at, resolved_by. Does NOT send the
// diner-facing waiter_ack push notification the API Specification also
// describes — waiter_calls has no participant_id column recording which
// specific diner at the table made the call, so there is no single reliable
// recipient. Left as an explicit, known gap rather than guessing (e.g.
// broadcasting to the whole table) — not part of this change's scope.

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
  const waiterCallId = (rawBody as Record<string, unknown>)?.waiter_call_id;
  if (typeof waiterCallId !== "string" || waiterCallId === "") {
    return errorResponse("MISSING_REQUIRED_FIELD", "Missing or invalid field: waiter_call_id", 400);
  }

  const { data: call, error: callError } = await admin
    .from("waiter_calls")
    .select("id, status, session_id, table_sessions!inner(restaurant_id)")
    .eq("id", waiterCallId)
    .maybeSingle();
  if (callError || !call) {
    return errorResponse("NOT_FOUND", "Waiter call not found", 404);
  }
  const restaurantId = (call.table_sessions as unknown as { restaurant_id: string }).restaurant_id;

  const { data: callerStaffRow } = await admin
    .from("staff")
    .select("id")
    .eq("user_id", callerId)
    .eq("restaurant_id", restaurantId)
    .eq("role", "waiter")
    .eq("is_active", true)
    .maybeSingle();
  if (!callerStaffRow) {
    return errorResponse("FORBIDDEN", "Only an active waiter on this restaurant can resolve a service call", 403);
  }

  if (call.status === "resolved") {
    return errorResponse("ALREADY_RESOLVED", "This call has already been resolved", 409);
  }

  const { data: updated, error: updateError } = await admin
    .from("waiter_calls")
    .update({ status: "resolved", resolved_at: new Date().toISOString(), resolved_by: callerStaffRow.id })
    .eq("id", waiterCallId)
    .select("id, status, resolved_at")
    .single();
  if (updateError || !updated) {
    console.error("resolve-waiter-call update failed", updateError);
    return errorResponse("INTERNAL_ERROR", "Failed to resolve the call", 500);
  }

  return jsonResponse({ waiter_call: updated }, 200);
});
