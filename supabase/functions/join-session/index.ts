// POST /functions/v1/join-session
// API Specification §6.2 — Backend Schema §4
//
// Auth: any signed-in REGISTERED caller. Product decision (2026-09-09):
// every diner is a registered account — no anonymous guest path — so the
// owner can learn from customers' own choices and personalize/optimize both
// the diner and restaurant sides. Anonymous Sign-In is disabled at the auth
// level (config.toml) for new sessions, but a token minted before that
// change could still be valid until it expires — the is_anonymous check
// below is the defense-in-depth backstop that actually enforces the policy,
// not just the config toggle. Adds the caller as a session_participants row
// on an open table_session, issuing a sub_account_number unique within that
// session. Called by every diner at the table, including the one who just
// called scan-qr — the first participant on a session becomes its host
// (is_host=true), determined server-side by participant count, not by a
// client-supplied flag.
//
// Security fix (2026-09-10, real cross-session hijack confirmed live): this
// function used to trust a bare session_id — any signed-in registered user
// who obtained a session's UUID by any means (leaked log, shared
// screenshot, a curious/malicious participant) could join a completely
// unrelated table's session and gain full participant-level read access to
// it, with zero proof they were ever at that table. session_id alone is
// deliberately NOT a capability token. The caller must now also present the
// qr_token of the table's own physical QR code (the same one scan-qr
// consumes) — proven server-side to resolve to the exact table_id backing
// this session_id. qr_code_token is a crypto.randomUUID() printed only on
// that table's own physical code (see TableManagerForm.tsx), so this ties
// every join to actual physical proximity, not just knowledge of an opaque
// ID. Every current legitimate caller already has qr_token in hand from
// their own scan-qr call moments earlier — this is not a breaking change
// for any real flow (there is no remote-invite path yet; see
// add-participants.tsx's own honest-gap comment).

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

// PRD §4 step 4: every participant's personal account number is 6 digits —
// mirrors scan-qr/index.ts's randomSessionAccountNumber() (same shape, same
// retry-on-duplicate insert pattern below).
function randomSubAccountNumber(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// In-app review verification code (2026-09-13) — shown on the account tab
// alongside sub_account_number; entered together to write a review later.
// No uniqueness requirement (always checked as a pair with the account
// number, which is already unique), so no retry loop needed here.
function randomReviewVerificationCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
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
  if (userData.user.is_anonymous) {
    return errorResponse("ACCOUNT_REQUIRED", "Feedbook requires a registered account — anonymous access is not supported", 403);
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
  const invitedBy = body?.invited_by_participant_id;
  if (invitedBy !== undefined && invitedBy !== null && typeof invitedBy !== "string") {
    return errorResponse("MISSING_REQUIRED_FIELD", "Invalid field: invited_by_participant_id", 400);
  }
  const qrToken = body?.qr_token;
  if (typeof qrToken !== "string" || qrToken === "") {
    return errorResponse("MISSING_REQUIRED_FIELD", "Missing or invalid field: qr_token", 400);
  }

  const { data: session, error: sessionError } = await admin
    .from("table_sessions")
    .select("id, table_id, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError || !session || session.status !== "open") {
    return errorResponse("SESSION_CLOSED", "This table is not open for new participants", 409);
  }

  // Proof of physical presence: qr_token must be the exact table this
  // session belongs to, not just any valid QR code. Knowing session_id
  // without also being able to produce the matching physical QR's own
  // token must never be enough to join — see the security note above.
  const { data: table, error: tableError } = await admin
    .from("tables")
    .select("id")
    .eq("qr_code_token", qrToken)
    .maybeSingle();
  if (tableError || !table || table.id !== session.table_id) {
    return errorResponse("INVALID_QR_CODE", "QR code does not match this table session", 403);
  }

  // Idempotency: with proper back/forward navigation now enabled in the app
  // (2026-09-10), a user can legitimately land on the "join" action for a
  // session they already joined (e.g. back to add-participants, forward
  // again). Without this, a second call would insert a duplicate
  // session_participants row and recompute is_host wrong (existingCount is
  // no longer 0 on the second call).
  // Plain select + limit(1), not .maybeSingle() — .maybeSingle() errors out
  // if more than one row matches, which would silently defeat this whole
  // check on any session that already has legacy duplicate rows (exactly
  // the kind this check exists to stop future ones of). Ordering by
  // joined_at picks the original join deterministically if duplicates do
  // exist already.
  const { data: existingParticipants } = await admin
    .from("session_participants")
    .select("id, sub_account_number, review_verification_code, is_host, joined_at")
    .eq("session_id", sessionId)
    .eq("user_id", callerId)
    .order("joined_at", { ascending: true })
    .limit(1);
  if (existingParticipants && existingParticipants.length > 0) {
    return jsonResponse({ participant: existingParticipants[0] }, 200);
  }

  const { count: existingCount } = await admin
    .from("session_participants")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);

  let participant: {
    id: string;
    sub_account_number: string;
    review_verification_code: string;
    is_host: boolean;
    joined_at: string;
  } | null = null;
  for (let attempt = 0; attempt < 5 && !participant; attempt++) {
    const { data, error } = await admin
      .from("session_participants")
      .insert({
        session_id: sessionId,
        user_id: callerId,
        sub_account_number: randomSubAccountNumber(),
        review_verification_code: randomReviewVerificationCode(),
        is_host: (existingCount ?? 0) === 0,
      })
      .select("id, sub_account_number, review_verification_code, is_host, joined_at")
      .single();
    if (!error) participant = data;
    else if (!error.message.includes("duplicate")) break;
  }

  if (!participant) {
    console.error("join-session insert failed");
    return errorResponse("INTERNAL_ERROR", "Failed to join session", 500);
  }

  return jsonResponse({ participant }, 201);
});
