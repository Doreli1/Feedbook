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
// member_participant_ids is the FULL desired membership after this call —
// not an append-only list (2026-11-15, real gap found live: the picker's
// own "already a member" checkboxes were disabled, so a diner who'd added
// someone had no way to undo it short of this function supporting removal).
// Anyone in the posted list not already billed to the caller gets linked;
// anyone currently billed to the caller but missing from the posted list
// gets unlinked (billed_to_participant_id set back to null — they go back
// to paying for themself). An empty array is valid and means "remove
// everyone". A target already billed to someone ELSE is rejected outright
// (ALREADY_LINKED) rather than silently stolen from that other account.
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
  // Empty is valid (2026-11-15) — "remove everyone" — only the shape is
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

  // Current membership (2026-11-15) — needed to compute who's being
  // removed, since a removed id is by definition NOT in the posted list and
  // so can't be found by looking the posted ids up.
  const { data: currentMembers, error: currentMembersError } = await admin
    .from("session_participants")
    .select("id")
    .eq("session_id", sessionId)
    .eq("billed_to_participant_id", caller.id);
  if (currentMembersError) {
    console.error("link-personal-account-members: current members lookup failed", currentMembersError);
    return errorResponse("INTERNAL_ERROR", "Failed to look up the account's current members", 500);
  }
  const currentMemberIds = new Set((currentMembers ?? []).map((m) => m.id));

  let targets: { id: string; session_id: string; billed_to_participant_id: string | null }[] = [];
  if (memberParticipantIds.length > 0) {
    const { data, error: targetsError } = await admin
      .from("session_participants")
      .select("id, session_id, billed_to_participant_id")
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
    const alreadyElsewhere = targets.find((t) => t.billed_to_participant_id !== null && t.billed_to_participant_id !== caller.id);
    if (alreadyElsewhere) {
      return errorResponse("ALREADY_LINKED", "One or more selected participants are already part of another personal account", 409);
    }
  }

  const newMemberIds = new Set(targets.map((t) => t.id));
  // Already billed to the caller (re-selecting an existing member) is a
  // harmless no-op, not re-written.
  const idsToLink = targets.filter((t) => t.billed_to_participant_id !== caller.id).map((t) => t.id);
  // Currently billed to the caller but missing from the posted list — sent
  // back to paying for themself.
  const idsToUnlink = Array.from(currentMemberIds).filter((id) => !newMemberIds.has(id));

  if (idsToLink.length > 0) {
    const { error: linkError } = await admin.from("session_participants").update({ billed_to_participant_id: caller.id }).in("id", idsToLink);
    if (linkError) {
      console.error("link-personal-account-members: link update failed", linkError);
      return errorResponse("INTERNAL_ERROR", "Failed to add the selected participants", 500);
    }
  }
  if (idsToUnlink.length > 0) {
    const { error: unlinkError } = await admin.from("session_participants").update({ billed_to_participant_id: null }).in("id", idsToUnlink);
    if (unlinkError) {
      console.error("link-personal-account-members: unlink update failed", unlinkError);
      return errorResponse("INTERNAL_ERROR", "Failed to remove the deselected participants", 500);
    }
  }

  return jsonResponse({ member_participant_ids: Array.from(newMemberIds) }, 200);
});
