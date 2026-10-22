// POST /functions/v1/decide-order-item-cancellation-request
//
// Manager-only approval/rejection of a waiter-initiated cancellation
// request (request-order-item-cancellation's own pending path — see
// 12.Feedbook_Accounts_Module_Spec v3). Approving performs the exact same
// cancellation the manager-direct path performs inline — no payment_events
// row, since the account hasn't been charged yet (see that function's own
// comment for why this is a line-item removal, not a refund); rejecting
// only updates the request row, order_items stays untouched.

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
  const requestId = body?.request_id;
  const decision = body?.decision;
  if (typeof requestId !== "string" || requestId === "") {
    return errorResponse("MISSING_REQUIRED_FIELD", "Missing or invalid field: request_id", 400);
  }
  if (decision !== "approve" && decision !== "reject") {
    return errorResponse("MISSING_REQUIRED_FIELD", "Field decision must be 'approve' or 'reject'", 400);
  }

  const { data: request, error: requestError } = await admin
    .from("order_item_cancellation_requests")
    .select(
      "id, status, reason, order_item_id, order_items!inner(id, status, quantity, unit_price, order_item_modifiers(price_delta_at_order), orders!inner(session_id, table_sessions!inner(restaurant_id)))",
    )
    .eq("id", requestId)
    .maybeSingle();
  if (requestError || !request) {
    return errorResponse("NOT_FOUND", "Cancellation request not found", 404);
  }
  if (request.status !== "pending") {
    return errorResponse("ALREADY_DECIDED", "This request was already decided", 409);
  }

  const item = request.order_items;
  const restaurantId = item.orders.table_sessions.restaurant_id;

  const { data: staffRow } = await admin
    .from("staff")
    .select("id")
    .eq("user_id", callerId)
    .eq("restaurant_id", restaurantId)
    .eq("role", "manager")
    .eq("is_active", true)
    .maybeSingle();
  if (!staffRow) {
    return errorResponse("FORBIDDEN", "Only a manager of this restaurant can decide this request", 403);
  }

  const nowIso = new Date().toISOString();

  if (decision === "reject") {
    const { error: rejectError } = await admin
      .from("order_item_cancellation_requests")
      .update({ status: "rejected", decided_by: staffRow.id, decided_at: nowIso })
      .eq("id", requestId);
    if (rejectError) {
      console.error("decide-order-item-cancellation-request reject failed", rejectError);
      return errorResponse("INTERNAL_ERROR", "Failed to reject the request", 500);
    }
    return jsonResponse({ status: "rejected" }, 200);
  }

  if (item.status === "cancelled") {
    return errorResponse("ITEM_ALREADY_CANCELLED", "This item is already cancelled", 409);
  }

  const { error: cancelError } = await admin
    .from("order_items")
    .update({ status: "cancelled", cancellation_reason: request.reason })
    .eq("id", request.order_item_id);
  if (cancelError) {
    console.error("decide-order-item-cancellation-request cancel failed", cancelError);
    return errorResponse("INTERNAL_ERROR", "Failed to cancel the item", 500);
  }

  const unitTotal = Number(item.unit_price) + (item.order_item_modifiers ?? []).reduce((sum, m) => sum + Number(m.price_delta_at_order), 0);
  const amount = unitTotal * item.quantity;

  const { error: approveError } = await admin
    .from("order_item_cancellation_requests")
    .update({ status: "approved", decided_by: staffRow.id, decided_at: nowIso })
    .eq("id", requestId);
  if (approveError) {
    console.error("decide-order-item-cancellation-request approve failed", approveError);
    return errorResponse("INTERNAL_ERROR", "Failed to finalize the approval", 500);
  }

  return jsonResponse({ status: "approved", amount }, 200);
});
