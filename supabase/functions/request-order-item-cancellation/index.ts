// POST /functions/v1/request-order-item-cancellation
//
// Staff-initiated cancellation of a dish on an active, not-yet-paid
// account (Web Admin "חשבונות" module, 2026-10-21 — see
// 12.Feedbook_Accounts_Module_Spec v3). Distinct from the diner's own
// self-service cancel (update-order-item, participant-only, time-windowed,
// in_progress-only) and from the "אי-התאמות" (non-conformances) module
// (post-serving quality issues) — neither of those is touched here.
//
// This is NOT a refund (clarified 2026-10-21): the account hasn't been
// charged yet, so there's nothing to credit back. It's a removal of the
// dish line from the diner's personal account — the account's own total
// (and the session's general total it rolls up into) is just the live sum
// of non-cancelled order_items, so removing one updates both totals for
// free, with no separate money-movement record. No payment_events row is
// written here; order_item_cancellation_requests (who/when/why, and for a
// waiter's request, who approved it) is the complete audit trail.
//
// Two-tier authorization: a manager cancels directly, in this same call —
// a waiter can only open a request that stays 'pending' until a manager
// decides it via decide-order-item-cancellation-request. Kitchen staff
// cannot call this at all.

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
  const orderItemId = body?.order_item_id;
  const reason = body?.reason;
  if (typeof orderItemId !== "string" || orderItemId === "") {
    return errorResponse("MISSING_REQUIRED_FIELD", "Missing or invalid field: order_item_id", 400);
  }
  if (typeof reason !== "string" || reason.trim() === "") {
    return errorResponse("MISSING_REQUIRED_FIELD", "Missing or invalid field: reason", 400);
  }

  const { data: item, error: itemError } = await admin
    .from("order_items")
    .select(
      "id, status, quantity, unit_price, order_item_modifiers(price_delta_at_order), orders!inner(session_id, table_sessions!inner(restaurant_id))",
    )
    .eq("id", orderItemId)
    .maybeSingle();
  if (itemError || !item) {
    return errorResponse("NOT_FOUND", "Order item not found", 404);
  }
  if (item.status === "cancelled") {
    return errorResponse("ITEM_ALREADY_CANCELLED", "This item is already cancelled", 409);
  }
  const restaurantId = item.orders.table_sessions.restaurant_id;

  const { data: staffRow } = await admin
    .from("staff")
    .select("id, role")
    .eq("user_id", callerId)
    .eq("restaurant_id", restaurantId)
    .eq("is_active", true)
    .maybeSingle();
  if (!staffRow || staffRow.role === "kitchen") {
    return errorResponse("FORBIDDEN", "Only a manager or waiter of this restaurant can request a cancellation", 403);
  }

  const unitTotal = Number(item.unit_price) + (item.order_item_modifiers ?? []).reduce((sum, m) => sum + Number(m.price_delta_at_order), 0);
  const amount = unitTotal * item.quantity;
  const nowIso = new Date().toISOString();

  if (staffRow.role === "manager") {
    const { data: request, error: requestError } = await admin
      .from("order_item_cancellation_requests")
      .insert({
        order_item_id: orderItemId,
        requested_by: staffRow.id,
        status: "approved",
        reason,
        decided_by: staffRow.id,
        decided_at: nowIso,
      })
      .select("id")
      .single();
    if (requestError) {
      console.error("request-order-item-cancellation insert (manager) failed", requestError);
      return errorResponse("INTERNAL_ERROR", "Failed to record the cancellation", 500);
    }

    const { error: cancelError } = await admin
      .from("order_items")
      .update({ status: "cancelled", cancellation_reason: reason })
      .eq("id", orderItemId);
    if (cancelError) {
      console.error("request-order-item-cancellation cancel (manager) failed", cancelError);
      return errorResponse("INTERNAL_ERROR", "Failed to cancel the item", 500);
    }

    return jsonResponse({ status: "cancelled", request_id: request.id, amount }, 200);
  }

  // waiter: opens a request only — order_items untouched until a manager
  // decides via decide-order-item-cancellation-request.
  const { data: request, error: requestError } = await admin
    .from("order_item_cancellation_requests")
    .insert({ order_item_id: orderItemId, requested_by: staffRow.id, status: "pending", reason })
    .select("id")
    .single();
  if (requestError) {
    console.error("request-order-item-cancellation insert (waiter) failed", requestError);
    return errorResponse("INTERNAL_ERROR", "Failed to submit the cancellation request", 500);
  }

  return jsonResponse({ status: "pending", request_id: request.id }, 200);
});
