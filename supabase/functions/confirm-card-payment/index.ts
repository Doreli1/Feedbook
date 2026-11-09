// POST /functions/v1/confirm-card-payment
// 2026-11-09, real feature — closes a real gap found live: the mobile app's
// bill-summary "בצעו תשלום" button, with "כרטיס אשראי" selected, used to
// call ONLY close-session (just flips table_sessions.status) — it never
// wrote any real payment/payment_participant_shares row, the same way the
// cash path's confirm-cash-payment does. That's why a diner who "paid" by
// card never saw their account's own status become "שולם" on the Web
// Admin side: useAccounts.ts's bottom-up computation (correctly) only
// calls an account genuinely settled once every real participant's own
// paymentStatus is 'paid' — a closed table_sessions row with zero real
// payment records behind it proves nothing (this exact "closed session ≠
// actually paid" shape of bug was already found and fixed twice this same
// week for the bar's general account and for ordinary tables — see
// project_general_bar_account_closed_by_schedule_bug memory).
//
// Auth: any signed-in registered session participant (same as call-waiter/
// leave-session) — unlike confirm-cash-payment, this is genuinely
// self-service: a real card charge completes instantly, with no waiter
// needing to physically confirm anything, so there's no staff-only gate
// here. Settles the caller's own personal share directly, and ALSO closes
// the general account (2026-11-09, explicit user correction/addition) once
// a real check confirms every OTHER real sub-account on the session is
// also genuinely settled (a paid share, or genuinely nothing ordered) —
// see that check's own comment below. Never applies to the bar, whose
// shared account is governed purely by its own operating hours
// (bar_close_if_inactive), not by individual diners paying.

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
  const body = rawBody as Record<string, unknown>;
  const sessionId = body?.session_id;
  if (typeof sessionId !== "string" || sessionId === "") {
    return errorResponse("MISSING_REQUIRED_FIELD", "Missing or invalid field: session_id", 400);
  }
  // Diner-chosen tip (2026-11-09) — same honest limitation as
  // confirm-cash-payment: there is no other server-side source for this,
  // it's a live UI choice with no persisted record of its own yet, so it's
  // trusted here the same way a real card-payment-provider's own "tip"
  // step would be, but validated as a real, non-negative number.
  const rawTip = body?.tip_amount;
  const tipAmount = typeof rawTip === "number" && Number.isFinite(rawTip) && rawTip >= 0 ? rawTip : 0;

  // Caller must be a real participant of this session — same pattern as
  // call-waiter's own check. This IS the "cash_payment_participant_id would
  // need validating" concern confirm-cash-payment's own comment raises,
  // except here there's nothing to validate against another party's claim:
  // the caller can only ever settle their own row.
  const { data: participant, error: participantError } = await admin
    .from("session_participants")
    .select("id, session_id, user_id, sub_account_number, bar_ticket_number, review_verification_code")
    .eq("session_id", sessionId)
    .eq("user_id", callerId)
    .maybeSingle();
  if (participantError || !participant) {
    return errorResponse("FORBIDDEN", "Caller is not a participant of this session", 403);
  }

  const { data: session, error: sessionError } = await admin
    .from("table_sessions")
    .select("restaurant_id, table_id, tables(table_type)")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError || !session) {
    return errorResponse("NOT_FOUND", "Session not found", 404);
  }
  const isBarSession = (session.tables as unknown as { table_type: string | null } | null)?.table_type === "bar";

  // Real subtotal, computed server-side from this participant's own
  // non-cancelled order_items — same shape as confirm-cash-payment's own
  // query, never trusted from the client.
  const { data: orderItemRows, error: itemsError } = await admin
    .from("order_items")
    .select("quantity, unit_price, status, orders!inner(participant_id), order_item_modifiers(price_delta_at_order)")
    .eq("orders.participant_id", participant.id)
    .neq("status", "cancelled");
  if (itemsError) {
    console.error("confirm-card-payment: order_items lookup failed", itemsError);
    return errorResponse("INTERNAL_ERROR", "Failed to compute the amount due", 500);
  }
  let subtotal = 0;
  for (const row of orderItemRows ?? []) {
    const modifierTotal = (row.order_item_modifiers ?? []).reduce((sum: number, m: { price_delta_at_order: number }) => sum + Number(m.price_delta_at_order), 0);
    subtotal += (Number(row.unit_price) + modifierTotal) * row.quantity;
  }
  const amountDue = subtotal + tipAmount;

  const receiptNumber = generatePlaceholderReceiptNumber();
  const nowIso = new Date().toISOString();

  const { data: payment, error: paymentError } = await admin
    .from("payments")
    .insert({
      session_id: sessionId,
      split_type: "even",
      total_amount: amountDue,
      service_fee: 0,
      status: "completed",
      payment_method: "credit_card",
      receipt_number: receiptNumber,
      paid_at: nowIso,
    })
    .select("id")
    .single();
  if (paymentError || !payment) {
    console.error("confirm-card-payment: payments insert failed", paymentError);
    return errorResponse("INTERNAL_ERROR", "Failed to record the payment", 500);
  }

  const { error: shareError } = await admin.from("payment_participant_shares").insert({
    payment_id: payment.id,
    participant_id: participant.id,
    amount_due: amountDue,
    amount_paid: amountDue,
    status: "paid",
    paid_at: nowIso,
    tip_amount: tipAmount,
  });
  if (shareError) {
    console.error("confirm-card-payment: payment_participant_shares insert failed", shareError);
    return errorResponse("INTERNAL_ERROR", "Failed to record the diner's share", 500);
  }

  // Closes the GENERAL account too, once every real sub-account on it is
  // settled (2026-11-09, explicit user request/correction — this used to
  // never touch table_sessions at all, leaving a fully-paid table sitting
  // "open" forever with no real close event). Table only, never the bar
  // (isBarSession) — the bar's shared account spans its own operating
  // hours regardless of which individual diners have paid (see
  // project_bar_general_account_spans_full_day memory); it is governed
  // exclusively by bar_close_if_inactive, never by an individual payment.
  // "Settled" mirrors useAccounts.ts's own bottom-up rule exactly: a real
  // paid share, OR genuinely nothing ordered (totalCost 0) — not just
  // "every participant has SOME share row".
  if (!isBarSession) {
    const { data: otherParticipants } = await admin.from("session_participants").select("id").eq("session_id", sessionId).neq("id", participant.id);
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
        .eq("payments.session_id", sessionId)
        .eq("status", "paid")
        .limit(1)
        .maybeSingle();
      if (!theirPaidShare) {
        everyoneElseSettled = false;
        break;
      }
    }
    if (everyoneElseSettled) {
      const { error: closeError } = await admin.from("table_sessions").update({ status: "closed", closed_at: nowIso }).eq("id", sessionId);
      if (closeError) {
        console.error("confirm-card-payment: failed to close the fully-settled session", closeError);
      } else {
        await admin.from("tables").update({ status: "awaiting_cleaning" }).eq("id", session.table_id);
      }
    }
  }

  // Same diner-facing "paid and closed" notification as confirm-cash-
  // payment, added 2026-11-09 for parity (explicit user request — card
  // payment is instant and self-service, but the diner should see the
  // same confirmation in their own profile's mail icon either way, not
  // just after a waiter confirms cash).
  const [{ data: profile }, { data: restaurant }] = await Promise.all([
    admin.from("user_profiles").select("display_name").eq("user_id", participant.user_id as string).maybeSingle(),
    admin.from("restaurants").select("name").eq("id", session.restaurant_id).maybeSingle(),
  ]);
  const firstName = (profile?.display_name ?? "").trim().split(/\s+/)[0] || "אורח";
  const personalAccountDisplay =
    participant.bar_ticket_number != null ? String(participant.bar_ticket_number).padStart(4, "0") : participant.sub_account_number;
  const title = `${restaurant?.name ?? ""} - חשבונית תשלום מס' ${receiptNumber}`;
  const notificationBody = `תודה ${firstName}!,\nחשבונך מספר ${personalAccountDisplay} שולם ונסגר, הקוד האישי שלך ${participant.review_verification_code}\nאנו נשמח לשמוע איך הייתה החוויה שלכם`;

  const { error: notificationError } = await admin.from("notifications").insert({
    user_id: participant.user_id,
    type: "payment_completed",
    title,
    body: notificationBody,
    session_id: sessionId,
  });
  if (notificationError) {
    // The payment itself already succeeded — logged, not surfaced as a
    // failure to a diner who already paid correctly.
    console.error("confirm-card-payment: notification insert failed", notificationError);
  }

  return jsonResponse({ receipt_number: receiptNumber, amount: amountDue }, 200);
});
