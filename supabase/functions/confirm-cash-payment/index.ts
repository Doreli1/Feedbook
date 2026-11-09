// POST /functions/v1/confirm-cash-payment
// 2026-11-08, real feature — see 20261108100000_cash_payment_confirmation.sql
//
// Auth: an ACTIVE staff member with role='waiter' for the restaurant this
// call belongs to — same restriction, same reasoning, as
// resolve-waiter-call/index.ts (PRD §5.1.4: the waiter who actually
// approaches the table and takes the cash, not "any staff").
//
// Settles ONLY this one diner's own personal share directly — never blindly
// force-closes the whole table the way the old close-session did. It DOES
// close the general account too (2026-11-09, explicit user
// correction/addition), but only once a real check confirms every OTHER
// real sub-account on the session is also genuinely settled (a paid share,
// or genuinely nothing ordered) — see that check's own comment below. Never
// applies to the bar, whose shared account is governed purely by its own
// operating hours (bar_close_if_inactive), not by individual diners paying.
// The real settlement amount is the diner's own order subtotal, computed
// server-side from order_items
// — never trusted from the client. A diner-chosen tip is NOT carried
// through from the bill-summary screen into this settlement amount: there
// is no persisted server-side record of that in-progress UI choice by the
// time a waiter actually confirms (it could change on the diner's screen in
// the meantime), so it is left at 0 here rather than trusting a stale or
// re-fetched client value for real money — an honest, documented gap, not
// a silent rounding error.
//
// receipt_number is a random placeholder standing in for a real invoice
// number from an actual clearing/payment-gateway integration (Stage 6) —
// there is no such system yet.

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

function generatePlaceholderReceiptNumber(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
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
    .select("id, status, call_type, cash_payment_participant_id, session_id, table_sessions!inner(restaurant_id, table_id, tables(table_type))")
    .eq("id", waiterCallId)
    .maybeSingle();
  if (callError || !call) {
    return errorResponse("NOT_FOUND", "Waiter call not found", 404);
  }
  const callSession = call.table_sessions as unknown as { restaurant_id: string; table_id: string; tables: { table_type: string | null } | null };
  const restaurantId = callSession.restaurant_id;
  const isBarSession = callSession.tables?.table_type === "bar";

  const { data: callerStaffRow } = await admin
    .from("staff")
    .select("id")
    .eq("user_id", callerId)
    .eq("restaurant_id", restaurantId)
    .eq("role", "waiter")
    .eq("is_active", true)
    .maybeSingle();
  if (!callerStaffRow) {
    return errorResponse("FORBIDDEN", "Only an active waiter on this restaurant can confirm a cash payment", 403);
  }

  if (call.call_type !== "cash_payment" || !call.cash_payment_participant_id) {
    return errorResponse("NOT_A_CASH_PAYMENT_CALL", "This call is not a cash-payment request", 409);
  }
  if (call.status === "resolved") {
    return errorResponse("ALREADY_RESOLVED", "This call has already been resolved", 409);
  }

  const { data: participant, error: participantError } = await admin
    .from("session_participants")
    .select("id, user_id, sub_account_number, bar_ticket_number, review_verification_code")
    .eq("id", call.cash_payment_participant_id)
    .maybeSingle();
  if (participantError || !participant || !participant.user_id) {
    console.error("confirm-cash-payment: participant lookup failed", participantError);
    return errorResponse("INTERNAL_ERROR", "Could not find the diner this call is about", 500);
  }

  // Real subtotal, computed server-side from this participant's own
  // non-cancelled order_items — same shape as useAccountItems.ts's own
  // (unitPrice + modifierTotal) * quantity, never trusted from the client.
  const { data: orderItemRows, error: itemsError } = await admin
    .from("order_items")
    .select("quantity, unit_price, status, orders!inner(participant_id), order_item_modifiers(price_delta_at_order)")
    .eq("orders.participant_id", participant.id)
    .neq("status", "cancelled");
  if (itemsError) {
    console.error("confirm-cash-payment: order_items lookup failed", itemsError);
    return errorResponse("INTERNAL_ERROR", "Failed to compute the amount due", 500);
  }
  let subtotal = 0;
  for (const row of orderItemRows ?? []) {
    const modifierTotal = (row.order_item_modifiers ?? []).reduce((sum: number, m: { price_delta_at_order: number }) => sum + Number(m.price_delta_at_order), 0);
    subtotal += (Number(row.unit_price) + modifierTotal) * row.quantity;
  }

  const receiptNumber = generatePlaceholderReceiptNumber();
  const nowIso = new Date().toISOString();

  const { data: payment, error: paymentError } = await admin
    .from("payments")
    .insert({
      session_id: call.session_id,
      split_type: "even",
      total_amount: subtotal,
      service_fee: 0,
      status: "completed",
      payment_method: "cash",
      receipt_number: receiptNumber,
      paid_at: nowIso,
    })
    .select("id")
    .single();
  if (paymentError || !payment) {
    console.error("confirm-cash-payment: payments insert failed", paymentError);
    return errorResponse("INTERNAL_ERROR", "Failed to record the payment", 500);
  }

  const { error: shareError } = await admin.from("payment_participant_shares").insert({
    payment_id: payment.id,
    participant_id: participant.id,
    amount_due: subtotal,
    amount_paid: subtotal,
    status: "paid",
    paid_at: nowIso,
    tip_amount: 0,
  });
  if (shareError) {
    console.error("confirm-cash-payment: payment_participant_shares insert failed", shareError);
    return errorResponse("INTERNAL_ERROR", "Failed to record the diner's share", 500);
  }

  const { error: resolveError } = await admin
    .from("waiter_calls")
    .update({ status: "resolved", resolved_at: nowIso, resolved_by: callerStaffRow.id })
    .eq("id", waiterCallId);
  if (resolveError) {
    console.error("confirm-cash-payment: waiter_calls resolve failed", resolveError);
    return errorResponse("INTERNAL_ERROR", "Payment was recorded, but failed to resolve the call", 500);
  }

  // Closes the GENERAL account too, once every real sub-account on it is
  // settled (2026-11-09, explicit user request/correction — this used to
  // never touch table_sessions at all, leaving a fully-paid table sitting
  // "open" forever with no real close event). Table only, never the bar
  // (isBarSession) — same reasoning as confirm-card-payment's own comment:
  // the bar's shared account spans its own operating hours regardless of
  // which individual diners have paid, governed exclusively by
  // bar_close_if_inactive. "Settled" mirrors useAccounts.ts's own
  // bottom-up rule: a real paid share, OR genuinely nothing ordered.
  if (!isBarSession) {
    const { data: otherParticipants } = await admin
      .from("session_participants")
      .select("id")
      .eq("session_id", call.session_id)
      .neq("id", participant.id);
    let everyoneElseSettled = true;
    for (const other of otherParticipants ?? []) {
      const { data: theirItems } = await admin
        .from("order_items")
        .select("quantity, unit_price, status, orders!inner(participant_id), order_item_modifiers(price_delta_at_order)")
        .eq("orders.participant_id", other.id)
        .neq("status", "cancelled");
      let theirSubtotal = 0;
      for (const row of theirItems ?? []) {
        const modifierTotal = (row.order_item_modifiers ?? []).reduce((sum: number, m: { price_delta_at_order: number }) => sum + Number(m.price_delta_at_order), 0);
        theirSubtotal += (Number(row.unit_price) + modifierTotal) * row.quantity;
      }
      if (theirSubtotal === 0) continue;
      const { data: theirPaidShare } = await admin
        .from("payment_participant_shares")
        .select("id, payments!inner(session_id)")
        .eq("participant_id", other.id)
        .eq("payments.session_id", call.session_id)
        .eq("status", "paid")
        .limit(1)
        .maybeSingle();
      if (!theirPaidShare) {
        everyoneElseSettled = false;
        break;
      }
    }
    if (everyoneElseSettled) {
      const { error: closeError } = await admin.from("table_sessions").update({ status: "closed", closed_at: nowIso }).eq("id", call.session_id);
      if (closeError) {
        console.error("confirm-cash-payment: failed to close the fully-settled session", closeError);
      } else {
        await admin.from("tables").update({ status: "awaiting_cleaning" }).eq("id", callSession.table_id);
      }
    }
  }

  const [{ data: profile }, { data: restaurant }] = await Promise.all([
    admin.from("user_profiles").select("display_name").eq("user_id", participant.user_id).maybeSingle(),
    admin.from("restaurants").select("name").eq("id", restaurantId).maybeSingle(),
  ]);
  const firstName = (profile?.display_name ?? "").trim().split(/\s+/)[0] || "אורח";
  const personalAccountDisplay =
    participant.bar_ticket_number != null ? String(participant.bar_ticket_number).padStart(4, "0") : participant.sub_account_number;
  const title = `${restaurant?.name ?? ""} - חשבונית תשלום מס' ${receiptNumber}`;
  const body = `תודה ${firstName}!,\nחשבונך מספר ${personalAccountDisplay} שולם ונסגר, הקוד האישי שלך ${participant.review_verification_code}\nאנו נשמח לשמוע איך הייתה החוויה שלכם`;

  const { error: notificationError } = await admin.from("notifications").insert({
    user_id: participant.user_id,
    type: "payment_completed",
    title,
    body,
    session_id: call.session_id,
  });
  if (notificationError) {
    // Payment + call resolution already succeeded — the diner's own account
    // already shows "שולם" either way (useAccounts.ts's bottom-up
    // computation), so this is logged, not surfaced as a failure to the
    // waiter who already did their job correctly.
    console.error("confirm-cash-payment: notification insert failed", notificationError);
  }

  return jsonResponse({ receipt_number: receiptNumber, amount: subtotal }, 200);
});
