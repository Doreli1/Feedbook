// POST /functions/v1/leave-session
//
// Auth: the calling participant themselves (not staff, not the host on
// someone else's behalf) — a self-service "end my visit" action for a
// diner who placed no order this session (2026-10-19, user request).
// Unlike close-session, this never touches the whole table_session for
// everyone else UNLESS this caller turns out to be the last active
// participant remaining, in which case it runs the same close as
// close-session so the table doesn't stay stuck "occupied" for no one.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.4";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VALID_REASONS = ["menu_not_suitable", "prices_not_suitable", "joined_by_mistake", "just_browsing", "changed_mind", "other"];

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
  const reason = body?.reason;
  const reasonOther = body?.reason_other;
  if (typeof sessionId !== "string" || sessionId === "") {
    return errorResponse("MISSING_REQUIRED_FIELD", "Missing or invalid field: session_id", 400);
  }
  if (typeof reason !== "string" || !VALID_REASONS.includes(reason)) {
    return errorResponse("MISSING_REQUIRED_FIELD", "Missing or invalid field: reason", 400);
  }
  if (reason === "other" && (typeof reasonOther !== "string" || reasonOther.trim() === "")) {
    return errorResponse("MISSING_REQUIRED_FIELD", "Missing or invalid field: reason_other", 400);
  }

  const { data: session, error: sessionError } = await admin
    .from("table_sessions")
    .select("id, table_id, restaurant_id, status, tables(table_type)")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError || !session) {
    return errorResponse("NOT_FOUND", "Session not found", 404);
  }

  // Must be an active (not already departed) participant of THIS session —
  // deliberately no host/staff escape hatch, unlike close-session: this is
  // "I am leaving", not "I am closing this out for the table".
  const { data: participant } = await admin
    .from("session_participants")
    .select("id")
    .eq("session_id", sessionId)
    .eq("user_id", callerId)
    .is("left_at", null)
    .maybeSingle();
  if (!participant) {
    return errorResponse("FORBIDDEN", "You are not an active participant of this session", 403);
  }

  // Server-side mirror of the mobile client's own hasNothingToPay gate
  // (AccountScreen.tsx) — never trust a stale client state for something
  // that ends a diner's presence at the table. A dish can't be ordered
  // without its own order_items row, so checking order_items alone (not
  // also order_item_modifiers) is a complete, equivalent check.
  const { data: openOrderItems } = await admin
    .from("order_items")
    .select("id, orders!inner(participant_id, session_id)")
    .eq("orders.session_id", sessionId)
    .eq("orders.participant_id", participant.id)
    .neq("status", "cancelled")
    .limit(1);
  if (openOrderItems && openOrderItems.length > 0) {
    return errorResponse("HAS_PENDING_ORDERS", "An order already exists for this participant in this session", 409);
  }

  const leftAt = new Date().toISOString();
  const { error: leaveError } = await admin
    .from("session_participants")
    .update({
      left_at: leftAt,
      left_reason: reason,
      left_reason_other: reason === "other" ? (reasonOther as string).trim() : null,
    })
    .eq("id", participant.id);
  if (leaveError) {
    console.error("leave-session update failed", leaveError);
    return errorResponse("INTERNAL_ERROR", "Failed to record leaving the session", 500);
  }

  let sessionClosed = false;
  if (session.status === "open") {
    const { data: remaining } = await admin
      .from("session_participants")
      .select("id")
      .eq("session_id", sessionId)
      .is("left_at", null)
      .limit(1);

    if (!remaining || remaining.length === 0) {
      // Same close-session gate (Backend Schema §4) — if some other,
      // already-settled part of the table still has an unpaid share on
      // record, leave the session open for staff to resolve manually
      // rather than silently closing out from underneath it.
      const { data: unpaidShares } = await admin
        .from("payment_participant_shares")
        .select("id, payments!inner(session_id)")
        .eq("payments.session_id", sessionId)
        .eq("status", "pending")
        .limit(1);

      if (!unpaidShares || unpaidShares.length === 0) {
        const { error: closeError } = await admin
          .from("table_sessions")
          .update({ status: "closed", closed_at: leftAt })
          .eq("id", sessionId);
        if (!closeError) {
          sessionClosed = true;
          if (session.tables?.table_type !== "bar") {
            await admin.from("tables").update({ status: "awaiting_cleaning" }).eq("id", session.table_id);
          }
        } else {
          console.error("leave-session auto-close failed", closeError);
        }
      }
    }
  }

  return jsonResponse({ status: "left", session_closed: sessionClosed }, 200);
});
