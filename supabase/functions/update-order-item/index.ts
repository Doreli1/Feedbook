// PATCH /functions/v1/update-order-item
// API Specification §7.2
//
// Auth: any signed-in registered session participant, but only for an
// order_item on one of THEIR OWN orders (resolved server-side via
// order_items -> orders.participant_id, same "resolve the caller's own row"
// pattern as place-order/join-session — a bare order_item_id is never
// trusted on its own).
//
// Guards, both from the mockup's own documented rule ("תוכלו לבצע שינויים
// אונליין ... ולא יאוחר מ-5 דקות אחרי ההזמנה"):
//   - the item must still be status = 'in_progress' (ITEM_ALREADY_READY)
//   - the edit must happen within 5 minutes of the order's placed_at
//     (EDIT_WINDOW_EXPIRED)
//
// "update" re-prices the item via update_order_item_transaction()
// (20260914095000) — changing size/modifiers only ever changes price, never
// JIT inventory (dish_ingredients links to dish_id, not to a size/modifier
// row). "cancel" sets status='cancelled' IMMEDIATELY — restaurant policy is
// that a cancellation inside the 5-minute edit window is final and never
// waits on the kitchen (2026-09-19: corrects a 2026-09-18 design mistake
// that made cancellation itself wait on kitchen confirmation). It does NOT
// call restock_inventory_for_order_item here, though: nobody yet knows
// whether the kitchen had already started using the ingredients. That's a
// separate, deferred inventory-bookkeeping question — the kitchen answers
// it afterward via record_cancellation_inventory_decision() (20260919),
// which only ever sets cancellation_restocked and optionally restocks; it
// never touches status, because the order is already cancelled by then.
// "cancel" also accepts an optional `cancellation_reason` (free text —
// the app now asks the diner to pick one before confirming) and stores it
// alongside the status change; notify_order_item_cancelled folds it into
// both the staff and diner notifications.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.4";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "PATCH, OPTIONS",
};

const EDIT_WINDOW_MINUTES = 5;

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
  if (req.method !== "PATCH") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only PATCH is supported", 405);
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
  if (typeof orderItemId !== "string" || orderItemId === "") {
    return errorResponse("MISSING_REQUIRED_FIELD", "Missing or invalid field: order_item_id", 400);
  }
  const action = body?.action;
  if (action !== "update" && action !== "cancel") {
    return errorResponse("MISSING_REQUIRED_FIELD", "action must be 'update' or 'cancel'", 400);
  }
  const sizeOptionId = body?.dish_size_option_id;
  if (sizeOptionId !== undefined && sizeOptionId !== null && typeof sizeOptionId !== "string") {
    return errorResponse("MISSING_REQUIRED_FIELD", "Invalid field: dish_size_option_id", 400);
  }
  const modifierIds = body?.modifier_option_ids;
  if (modifierIds !== undefined && !Array.isArray(modifierIds)) {
    return errorResponse("MISSING_REQUIRED_FIELD", "Invalid field: modifier_option_ids", 400);
  }
  const cancellationReason = body?.cancellation_reason;
  if (cancellationReason !== undefined && cancellationReason !== null && typeof cancellationReason !== "string") {
    return errorResponse("MISSING_REQUIRED_FIELD", "Invalid field: cancellation_reason", 400);
  }

  const { data: orderItem, error: itemError } = await admin
    .from("order_items")
    .select("id, status, order_id, orders!inner(id, participant_id, placed_at, session_participants!inner(user_id))")
    .eq("id", orderItemId)
    .maybeSingle();

  if (itemError || !orderItem) {
    return errorResponse("FORBIDDEN", "Order item not found", 403);
  }

  // Supabase-js nests the joined rows under their table name; both
  // orders/session_participants come back as single objects here since
  // both relationships are to-one from order_items' perspective.
  const order = orderItem.orders as unknown as { id: string; participant_id: string; placed_at: string; session_participants: { user_id: string | null } };
  if (!order || order.session_participants?.user_id !== callerId) {
    return errorResponse("FORBIDDEN", "Caller does not own this order item", 403);
  }

  if (orderItem.status !== "in_progress") {
    return errorResponse("ITEM_ALREADY_READY", "This item can no longer be modified", 409);
  }

  const placedAt = new Date(order.placed_at).getTime();
  const elapsedMinutes = (Date.now() - placedAt) / 60000;
  if (elapsedMinutes > EDIT_WINDOW_MINUTES) {
    return errorResponse("EDIT_WINDOW_EXPIRED", "The 5-minute edit window for this order has passed", 409);
  }

  if (action === "cancel") {
    const { data: updated, error: updateError } = await admin
      .from("order_items")
      .update({ status: "cancelled", cancellation_reason: cancellationReason ?? null })
      .eq("id", orderItemId)
      .select("id, status")
      .single();
    if (updateError || !updated) {
      return errorResponse("INTERNAL_ERROR", "Failed to cancel item", 500);
    }
    // Fire-and-forget: notification fan-out is not part of the cancellation
    // contract with the caller — the item is already cancelled either way,
    // so a notification-insert hiccup must never turn into a 500 here.
    const { error: notifyError } = await admin.rpc("notify_order_item_cancelled", { p_order_item_id: orderItemId });
    if (notifyError) {
      console.error("notify_order_item_cancelled failed", notifyError);
    }
    return jsonResponse({ order_item: updated }, 200);
  }

  const { data: newTotal, error: updateRpcError } = await admin
    .rpc("update_order_item_transaction", {
      p_order_item_id: orderItemId,
      p_dish_size_option_id: sizeOptionId ?? null,
      p_modifier_option_ids: (modifierIds as string[] | undefined) ?? [],
    })
    .single();

  if (updateRpcError) {
    if ((updateRpcError.message ?? "").includes("DISH_NOT_AVAILABLE")) {
      return errorResponse("DISH_NOT_AVAILABLE", "Selected size or modifier is not available for this dish", 422);
    }
    console.error("update_order_item_transaction failed", updateRpcError);
    return errorResponse("INTERNAL_ERROR", "Failed to update item", 500);
  }

  const { data: updated } = await admin
    .from("order_items")
    .select("id, status, unit_price, dish_size_option_id")
    .eq("id", orderItemId)
    .single();

  return jsonResponse({ order_item: { ...updated, total_price: newTotal } }, 200);
});
