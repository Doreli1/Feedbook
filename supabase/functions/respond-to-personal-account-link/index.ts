// POST /functions/v1/respond-to-personal-account-link
//
// Real feature (2026-11-17, explicit user request): the other half of the
// consent flow link-personal-account-members starts — the TARGET's own
// response, acting on THEIR OWN session_participants row. Two actions:
//
//   - "approve": requires pending_billing_request_from to be set. Promotes
//     it to billed_to_participant_id (the request becomes a real, active
//     link) and clears the pending field.
//   - "decline": clears whichever of the two fields is actually set on the
//     caller's own row — a still-pending request they don't want (rejects
//     it, never became a link), OR an already-approved link they want to
//     back out of now (self-service "I changed my mind, let me pay for
//     myself again" — this is the SAME action as rejecting a request,
//     just acting on billed_to_participant_id instead; no reason to make
//     the diner-facing UI distinguish two different undo buttons for what
//     is, from their side, the same "I don't want this" choice).
//
// Auth: the calling participant themselves — self-service, same shape as
// leave-session/link-personal-account-members. There is no way for the
// REQUESTER to act on this endpoint on the target's behalf; only the
// target's own token can approve or decline their own row.
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

  // Real feature (2026-11-25) — same sweep as link-personal-account-members's
  // own, called here too so a friend can never approve/decline a request
  // that's already past its 1-minute window by the time they act on it (it
  // simply reads as NO_PENDING_REQUEST/NOTHING_TO_DECLINE below instead).
  await admin.rpc("expire_stale_billing_requests");

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse("MISSING_REQUIRED_FIELD", "Request body must be valid JSON", 400);
  }
  const body = rawBody as Record<string, unknown>;
  const sessionId = body?.session_id;
  const action = body?.action;
  if (typeof sessionId !== "string" || sessionId === "") {
    return errorResponse("MISSING_REQUIRED_FIELD", "Missing or invalid field: session_id", 400);
  }
  if (action !== "approve" && action !== "decline") {
    return errorResponse("MISSING_REQUIRED_FIELD", "action must be 'approve' or 'decline'", 400);
  }

  const { data: caller, error: callerError } = await admin
    .from("session_participants")
    .select("id, billed_to_participant_id, pending_billing_request_from")
    .eq("session_id", sessionId)
    .eq("user_id", callerId)
    .is("left_at", null)
    .maybeSingle();
  if (callerError || !caller) {
    return errorResponse("FORBIDDEN", "You are not an active participant of this session", 403);
  }

  if (action === "approve") {
    if (!caller.pending_billing_request_from) {
      return errorResponse("NO_PENDING_REQUEST", "You have no pending request to approve", 404);
    }
    const { error: approveError } = await admin
      .from("session_participants")
      .update({ billed_to_participant_id: caller.pending_billing_request_from, pending_billing_request_from: null, pending_billing_request_at: null })
      .eq("id", caller.id);
    if (approveError) {
      console.error("respond-to-personal-account-link: approve failed", approveError);
      return errorResponse("INTERNAL_ERROR", "Failed to approve the request", 500);
    }
    return jsonResponse({ status: "approved", billed_to_participant_id: caller.pending_billing_request_from }, 200);
  }

  // decline
  if (caller.pending_billing_request_from) {
    const { error: declineError } = await admin
      .from("session_participants")
      .update({ pending_billing_request_from: null, pending_billing_request_at: null })
      .eq("id", caller.id);
    if (declineError) {
      console.error("respond-to-personal-account-link: decline (pending) failed", declineError);
      return errorResponse("INTERNAL_ERROR", "Failed to decline the request", 500);
    }
    return jsonResponse({ status: "declined" }, 200);
  }
  if (caller.billed_to_participant_id) {
    const { error: cancelError } = await admin
      .from("session_participants")
      .update({ billed_to_participant_id: null })
      .eq("id", caller.id);
    if (cancelError) {
      console.error("respond-to-personal-account-link: cancel (active link) failed", cancelError);
      return errorResponse("INTERNAL_ERROR", "Failed to cancel the link", 500);
    }
    return jsonResponse({ status: "cancelled" }, 200);
  }
  return errorResponse("NOTHING_TO_DECLINE", "You have no pending request or active link to decline", 404);
});
