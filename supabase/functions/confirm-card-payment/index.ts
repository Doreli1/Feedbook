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
//
// Combined personal-account billing (2026-11-15, real feature — see
// 20261115090000_personal_account_members.sql): a diner can add other real
// table-mates to their own personal account (link-personal-account-members),
// at which point THIS function settles the whole group in one call instead
// of just the caller — every participant whose billed_to_participant_id
// points at the caller is pulled in. The caller picks how the group's
// combined order is divided via the client-supplied split_mode:
//   - 'even' (the default, including when split_mode is omitted): the
//     combined subtotal is divided evenly across every group member
//     (caller included); each member's own share reflects that equal
//     slice, with the diner-chosen tip folded only into the caller's own
//     share — this is one real card transaction either way, bookkept per
//     member for reporting, not a promise that each friend's own card was
//     separately charged.
//   - 'full': the caller's own share covers the ENTIRE combined subtotal
//     (+ tip); every other member's share records their own real order
//     value for transparency but amount_paid stays 0 — they were treated,
//     not separately charged.
// A caller with no group (the common/default case — nobody added) hits
// neither branch meaningfully: allMembers is just [caller], so every sum
// below collapses back to exactly the original single-participant amounts.
//
// STAGE 6 DISCLAIMER (carried over from this function's own original header,
// lost during the 2026-11-15 group-billing rewrite above — see
// confirm-cash-payment/index.ts for the same note, still intact there):
// there is NO real card charge anywhere in this function. receipt_number is
// a random placeholder, not a real clearing reference, and everything below
// — writing payments/payment_participant_shares, marking left_at, closing
// the session — runs unconditionally the moment this function is invoked,
// standing in for "a real charge just succeeded" without ever verifying one
// actually did. When Tranzila (or any real processor) is wired in, that real
// charge-and-confirm step MUST be inserted and MUST succeed before any of
// this function's own DB writes run (or this logic moves into a webhook
// handler Tranzila calls back on success) — everything else here (auth,
// the server-computed subtotal, the combined-group split math, the
// settlement side effects) is payment-rail-agnostic and can stay as-is.
// Skipping that gate would mark an account "שולם" with zero money ever
// actually collected.

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

interface GroupMember {
  id: string;
  user_id: string;
  sub_account_number: string | null;
  bar_ticket_number: number | null;
  review_verification_code: string | null;
}

// Real subtotal for one participant, computed server-side from their own
// non-cancelled order_items — never trusted from the client. Shared by the
// caller's own amount, every group member's own amount, and the
// "everyone else settled" check further down, which all used to duplicate
// this exact query before the group-billing feature existed.
async function computeParticipantSubtotal(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  participantId: string,
): Promise<number | null> {
  const { data: rows, error } = await admin
    .from("order_items")
    .select("quantity, unit_price, status, orders!inner(participant_id), order_item_modifiers(price_delta_at_order)")
    .eq("orders.participant_id", participantId)
    .neq("status", "cancelled");
  if (error) {
    console.error("confirm-card-payment: order_items lookup failed", error);
    return null;
  }
  let subtotal = 0;
  for (const row of rows ?? []) {
    const modifierTotal = (row.order_item_modifiers ?? []).reduce((sum: number, m: { price_delta_at_order: number }) => sum + Number(m.price_delta_at_order), 0);
    subtotal += (Number(row.unit_price) + modifierTotal) * row.quantity;
  }
  return subtotal;
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
  // Group split choice (2026-11-15) — only meaningful once a real group
  // exists below; defaults to 'even' when omitted or unrecognized, matching
  // the mobile client's own default-selected value.
  const splitMode: "even" | "full" = body?.split_mode === "full" ? "full" : "even";

  // Caller must be a real participant of this session — same pattern as
  // call-waiter's own check. This IS the "cash_payment_participant_id would
  // need validating" concern confirm-cash-payment's own comment raises,
  // except here there's nothing to validate against another party's claim:
  // the caller can only ever settle their own row (and, now, whoever is
  // genuinely billed to it — never an arbitrary id the client could pass).
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

  // Combined personal-account members (2026-11-15) — anyone the caller has
  // added to their own account via link-personal-account-members. Empty for
  // the common/default case of a solo payer, in which case allMembers below
  // is just [participant] and every branch that follows behaves exactly as
  // it always did before this feature existed.
  const { data: groupMembers, error: groupMembersError } = await admin
    .from("session_participants")
    .select("id, user_id, sub_account_number, bar_ticket_number, review_verification_code")
    .eq("session_id", sessionId)
    .eq("billed_to_participant_id", participant.id);
  if (groupMembersError) {
    console.error("confirm-card-payment: group members lookup failed", groupMembersError);
    return errorResponse("INTERNAL_ERROR", "Failed to look up the combined account's members", 500);
  }
  const allMembers: GroupMember[] = [participant, ...(groupMembers ?? [])];
  const allMemberIds = allMembers.map((m) => m.id);

  // Real duplicate-payment bug found live (2026-11-09): nothing here ever
  // checked whether this participant had already paid before writing a
  // brand-new payments/payment_participant_shares row — a second
  // "בצעו תשלום" tap (the bill-summary success modal's own "clear session
  // and leave" step depends on the diner actually dismissing it; if they
  // don't, or the screen reloads first, they stay on a now-already-paid
  // account with nothing stopping them from paying again) silently wrote a
  // full SECOND payment, double-counting totalTip/totalCredit on the Web
  // Admin side (confirmed live: a real diner showed a 32 ₪ tip for one real
  // 16 ₪ tip). The client treats this exact error code as a soft success
  // (see bill-summary.tsx's own comment) so a diner who re-taps pay after
  // already paying still gets the normal "you're done" flow, not a dead
  // end. Widened (2026-11-15) to the whole combined group — any member
  // already paid blocks the entire call rather than risking a second,
  // overlapping payment for part of the same group.
  const { data: existingPaidShares, error: existingPaidError } = await admin
    .from("payment_participant_shares")
    .select("id")
    .in("participant_id", allMemberIds)
    .eq("status", "paid")
    .limit(1);
  if (existingPaidError) {
    console.error("confirm-card-payment: existing-paid lookup failed", existingPaidError);
    return errorResponse("INTERNAL_ERROR", "Failed to check for an existing payment", 500);
  }
  if (existingPaidShares && existingPaidShares.length > 0) {
    return errorResponse("ALREADY_PAID", "This account has already been paid", 409);
  }

  const subtotalsByParticipantId = new Map<string, number>();
  for (const member of allMembers) {
    const memberSubtotal = await computeParticipantSubtotal(admin, member.id);
    if (memberSubtotal === null) {
      return errorResponse("INTERNAL_ERROR", "Failed to compute the amount due", 500);
    }
    subtotalsByParticipantId.set(member.id, memberSubtotal);
  }
  const combinedSubtotal = Array.from(subtotalsByParticipantId.values()).reduce((sum, s) => sum + s, 0);
  const amountDue = combinedSubtotal + tipAmount;

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

  // One share per group member (just the caller in the common solo case).
  // 'even': the combined subtotal is divided equally across every member,
  // tip folded only into the caller's own share. 'full': the caller's share
  // covers everyone's combined subtotal + tip; every other member's share
  // keeps their own real subtotal as amount_due (transparency — what they
  // actually consumed) but amount_paid 0 (no money moved on their behalf).
  const perShare = combinedSubtotal / allMembers.length;
  const shareRows = allMembers.map((member) => {
    const isCaller = member.id === participant.id;
    if (splitMode === "full" && !isCaller) {
      return {
        payment_id: payment.id,
        participant_id: member.id,
        amount_due: subtotalsByParticipantId.get(member.id) ?? 0,
        amount_paid: 0,
        status: "paid",
        paid_at: nowIso,
        tip_amount: 0,
      };
    }
    const amount = splitMode === "full" ? amountDue : perShare + (isCaller ? tipAmount : 0);
    return {
      payment_id: payment.id,
      participant_id: member.id,
      amount_due: amount,
      amount_paid: amount,
      status: "paid",
      paid_at: nowIso,
      tip_amount: isCaller ? tipAmount : 0,
    };
  });

  const { error: shareError } = await admin.from("payment_participant_shares").insert(shareRows);
  if (shareError) {
    console.error("confirm-card-payment: payment_participant_shares insert failed", shareError);
    return errorResponse("INTERNAL_ERROR", "Failed to record the diner's share", 500);
  }

  // Marks every settled diner as done with their own visit (2026-11-09,
  // real infinite-loop bug found live, widened 2026-11-15 to the whole
  // combined group) — same left_at signal leave-session's own explicit
  // walkout already uses (left_reason stays null; none of its existing
  // values mean "paid", and this isn't the place to invent one). Without
  // this, get_my_open_session() kept finding this still-technically-'open'
  // session (the bar never auto-closes on an individual payment) even
  // after paying, so the mail icon's "open visit" reminder immediately
  // re-offered to resume the very session this diner just settled and left
  // — tapping it restored the same already-paid session, which on the next
  // disconnect re-triggered the same reminder: a real connect/kick-out loop.
  // A friend paid FOR under 'full' mode is just as done with their visit as
  // the caller, even though no money moved on their own share.
  const { error: leftError } = await admin.from("session_participants").update({ left_at: nowIso }).in("id", allMemberIds);
  if (leftError) {
    // The payment itself already succeeded — logged, not surfaced as a
    // failure to diners who already paid correctly.
    console.error("confirm-card-payment: failed to mark participants left_at", leftError);
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
  // "every participant has SOME share row". Excludes the WHOLE combined
  // group just settled above (2026-11-15), not just the caller alone.
  if (!isBarSession) {
    const { data: otherParticipants } = await admin
      .from("session_participants")
      .select("id")
      .eq("session_id", sessionId)
      .not("id", "in", `(${allMemberIds.join(",")})`);
    let everyoneElseSettled = true;
    for (const other of otherParticipants ?? []) {
      const theirSubtotal = await computeParticipantSubtotal(admin, other.id);
      if (theirSubtotal === null) {
        everyoneElseSettled = false;
        break;
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
  // just after a waiter confirms cash). Sent to every settled group member
  // (2026-11-15), not just the caller — a friend paid FOR needs the same
  // signal or they'd hit the exact same "open visit" reminder loop the
  // left_at fix above already exists to prevent.
  const { data: restaurant } = await admin.from("restaurants").select("name").eq("id", session.restaurant_id).maybeSingle();
  for (const member of allMembers) {
    const { data: profile } = await admin.from("user_profiles").select("display_name").eq("user_id", member.user_id).maybeSingle();
    const firstName = (profile?.display_name ?? "").trim().split(/\s+/)[0] || "אורח";
    const personalAccountDisplay = member.bar_ticket_number != null ? String(member.bar_ticket_number).padStart(4, "0") : member.sub_account_number;
    const title = `${restaurant?.name ?? ""} - חשבונית תשלום מס' ${receiptNumber}`;
    const notificationBody = `תודה ${firstName}!,\nחשבונך מספר ${personalAccountDisplay} שולם ונסגר, הקוד האישי שלך ${member.review_verification_code}\nאנו נשמח לשמוע איך הייתה החוויה שלכם`;

    const { error: notificationError } = await admin.from("notifications").insert({
      user_id: member.user_id,
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
  }

  return jsonResponse({ receipt_number: receiptNumber, amount: amountDue }, 200);
});
