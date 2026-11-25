// POST /functions/v1/link-personal-account-members
//
// Real feature (2026-11-15, explicit user request): "הוספת חבר לחשבון
// האישי" — a diner on bill-summary.tsx adds an EXISTING table-mate (already
// a real session_participants row — not a brand-new QR invite, that's
// add-participants.tsx's own separate flow) to their own personal account,
// so one person ends up paying for/splitting with another.
//
// Auth: the calling participant themselves, same self-service shape as
// leave-session — there is no host/staff escape hatch here either, this is
// "I am managing MY account's membership", nothing broader.
//
// Consent (2026-11-17, explicit user request/real gap found live): this
// function no longer links anyone unilaterally. A new target gets
// pending_billing_request_from = caller.id — a REQUEST, not a link — and
// only actually becomes billed_to_participant_id once the target approves
// it themselves (respond-to-personal-account-link). member_participant_ids
// is still the FULL desired membership (requests + already-approved
// members combined) — anyone in the posted list not already
// requested/linked by the caller gets a new request; anyone currently
// requested or linked by the caller but missing from the posted list gets
// cleared (cancels a still-pending request, or removes an already-approved
// member — the caller can always undo their own side of this without the
// other party's consent, only ADDING needs it). An empty array is valid and
// means "clear everything". A target already requested/linked by someone
// ELSE is rejected outright, not silently stolen from that other account.
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
  const memberParticipantIds = body?.member_participant_ids;
  if (typeof sessionId !== "string" || sessionId === "") {
    return errorResponse("MISSING_REQUIRED_FIELD", "Missing or invalid field: session_id", 400);
  }
  // Empty is valid (2026-11-15) — "clear everything" — only the shape is
  // validated here, not a minimum length.
  if (!Array.isArray(memberParticipantIds) || !memberParticipantIds.every((id) => typeof id === "string")) {
    return errorResponse("MISSING_REQUIRED_FIELD", "member_participant_ids must be an array of strings", 400);
  }

  // Caller must be a real, still-active participant of this exact session —
  // same shape as leave-session's own check.
  const { data: caller } = await admin
    .from("session_participants")
    .select("id")
    .eq("session_id", sessionId)
    .eq("user_id", callerId)
    .is("left_at", null)
    .maybeSingle();
  if (!caller) {
    return errorResponse("FORBIDDEN", "You are not an active participant of this session", 403);
  }

  if (memberParticipantIds.includes(caller.id)) {
    return errorResponse("CANNOT_ADD_SELF", "You cannot add yourself to your own account", 422);
  }

  // Current relationship (2026-11-17) — anyone the caller has either
  // already requested OR already has approved/billed to them. Needed to
  // compute who's being cleared, since a cleared id is by definition NOT in
  // the posted list and so can't be found by looking the posted ids up.
  const { data: currentMembers, error: currentMembersError } = await admin
    .from("session_participants")
    .select("id, billed_to_participant_id, pending_billing_request_from")
    .eq("session_id", sessionId)
    .or(`billed_to_participant_id.eq.${caller.id},pending_billing_request_from.eq.${caller.id}`);
  if (currentMembersError) {
    console.error("link-personal-account-members: current members lookup failed", currentMembersError);
    return errorResponse("INTERNAL_ERROR", "Failed to look up the account's current members", 500);
  }
  const currentMemberIds = new Set((currentMembers ?? []).map((m) => m.id));

  let targets: { id: string; session_id: string; billed_to_participant_id: string | null; pending_billing_request_from: string | null; left_at: string | null }[] = [];
  if (memberParticipantIds.length > 0) {
    const { data, error: targetsError } = await admin
      .from("session_participants")
      .select("id, session_id, billed_to_participant_id, pending_billing_request_from, left_at")
      .in("id", memberParticipantIds as string[]);
    if (targetsError) {
      console.error("link-personal-account-members: target lookup failed", targetsError);
      return errorResponse("INTERNAL_ERROR", "Failed to look up the selected participants", 500);
    }
    targets = data ?? [];
    if (targets.length !== memberParticipantIds.length) {
      return errorResponse("NOT_FOUND", "One or more selected participants were not found", 404);
    }
    if (targets.some((t) => t.session_id !== sessionId)) {
      return errorResponse("FORBIDDEN", "One or more selected participants are not part of this session", 403);
    }
    // Real bug found live (2026-11-17): nothing here ever checked whether a
    // target had already paid and left (same left_at signal confirm-card-
    // payment sets) — a departed diner kept being requestable as if still
    // an active table-mate.
    const alreadyLeft = targets.find((t) => t.left_at !== null);
    if (alreadyLeft) {
      return errorResponse("PARTICIPANT_ALREADY_LEFT", "One or more selected participants have already paid and left", 409);
    }
    const alreadyElsewhere = targets.find((t) => t.billed_to_participant_id !== null && t.billed_to_participant_id !== caller.id);
    if (alreadyElsewhere) {
      return errorResponse("ALREADY_LINKED", "One or more selected participants are already part of another personal account", 409);
    }
    const pendingElsewhere = targets.find((t) => t.pending_billing_request_from !== null && t.pending_billing_request_from !== caller.id);
    if (pendingElsewhere) {
      return errorResponse("REQUEST_ALREADY_PENDING", "One or more selected participants already have a pending request from someone else", 409);
    }
  }

  const newMemberIds = new Set(targets.map((t) => t.id));
  // Only a target with neither an existing request nor an existing approved
  // link from the caller gets a fresh request — re-selecting an
  // already-requested/already-approved one is a harmless no-op.
  const idsToRequest = targets.filter((t) => t.billed_to_participant_id !== caller.id && t.pending_billing_request_from !== caller.id).map((t) => t.id);
  // Currently requested or linked by the caller but missing from the posted
  // list — cancels a still-pending request, or removes an already-approved
  // member. Both fields are cleared unconditionally for these ids: by
  // construction at most one of them was ever actually set to the caller
  // at a time, so clearing both is safe and avoids needing to know which.
  const idsToClear = Array.from(currentMemberIds).filter((id) => !newMemberIds.has(id));

  if (idsToRequest.length > 0) {
    const { error: requestError } = await admin
      .from("session_participants")
      .update({ pending_billing_request_from: caller.id })
      .in("id", idsToRequest);
    if (requestError) {
      console.error("link-personal-account-members: request update failed", requestError);
      return errorResponse("INTERNAL_ERROR", "Failed to send the request to the selected participants", 500);
    }
  }
  if (idsToClear.length > 0) {
    const { error: clearError } = await admin
      .from("session_participants")
      .update({ billed_to_participant_id: null, pending_billing_request_from: null })
      .in("id", idsToClear);
    if (clearError) {
      console.error("link-personal-account-members: clear update failed", clearError);
      return errorResponse("INTERNAL_ERROR", "Failed to remove the deselected participants", 500);
    }
  }

  return jsonResponse({ member_participant_ids: Array.from(newMemberIds) }, 200);
});
