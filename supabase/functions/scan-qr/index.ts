// POST /functions/v1/scan-qr
// API Specification §6.1 — Backend Schema §4
//
// Auth: any signed-in REGISTERED caller. Product decision (2026-09-09):
// every diner is a registered account — no anonymous guest path — so the
// owner can learn from customers' own choices and personalize/optimize both
// the diner and restaurant sides. Anonymous Sign-In is disabled at the auth
// level (config.toml) for new sessions, but a token minted before that
// change could still be valid until it expires — the is_anonymous check
// below is the defense-in-depth backstop that actually enforces the policy,
// not just the config toggle. Resolves a table's qr_code_token to its
// restaurant + table, and either opens a new table_session (table was
// 'available') or returns the existing open one (table was 'occupied') —
// this is the Deep Link entry point of the whole diner journey (AFD §2.1,
// §5).
//
// Runs under service_role because a guest has no staff-scoped RLS access to
// `tables` at all (RLS: "staff_manage_own_restaurant_tables" is staff-only —
// by design, a diner should never be able to browse tables directly via
// PostgREST, only resolve one specific table through its own QR token).
//
// Does NOT create a session_participants row for the caller — that's
// join-session's job (called immediately after, by the same client), which
// also handles is_host assignment for the first participant.

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

function randomSessionAccountNumber(): string {
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
  if (userData.user.is_anonymous) {
    return errorResponse("ACCOUNT_REQUIRED", "Feedbook requires a registered account — anonymous access is not supported", 403);
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse("MISSING_REQUIRED_FIELD", "Request body must be valid JSON", 400);
  }
  const qrToken = (rawBody as Record<string, unknown>)?.qr_token;
  if (typeof qrToken !== "string" || qrToken === "") {
    return errorResponse("MISSING_REQUIRED_FIELD", "Missing or invalid field: qr_token", 400);
  }

  const { data: table, error: tableError } = await admin
    .from("tables")
    .select(
      "*, restaurant:restaurants(id, name, logo_url, description, cuisine_tags, cancellation_window_minutes, address, phone, hours, kosher_status, kosher_certificate_url)",
    )
    .eq("qr_code_token", qrToken)
    .maybeSingle();

  if (tableError || !table) {
    return errorResponse("INVALID_QR_CODE", "QR code is not valid", 400);
  }
  if (table.status === "awaiting_payment") {
    return errorResponse("TABLE_NOT_ACTIVE", "This table is not accepting new sessions right now", 409);
  }

  let session: { id: string; session_account_number: string; status: string } | null = null;

  if (table.status === "occupied") {
    const { data: existing } = await admin
      .from("table_sessions")
      .select("id, session_account_number, status")
      .eq("table_id", table.id)
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    session = existing ?? null;
  }

  if (!session) {
    // Either the table was genuinely 'available', or it was marked
    // 'occupied' with no matching open session (shouldn't normally happen —
    // recovered here rather than surfacing a confusing error to a guest).
    let inserted = null;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const { data, error } = await admin
        .from("table_sessions")
        .insert({
          restaurant_id: table.restaurant_id,
          table_id: table.id,
          session_account_number: randomSessionAccountNumber(),
        })
        .select("id, session_account_number, status")
        .single();
      if (!error) inserted = data;
      else if (!error.message.includes("duplicate")) break;
    }
    if (!inserted) {
      return errorResponse("INTERNAL_ERROR", "Failed to open a table session", 500);
    }
    session = inserted;
    await admin.from("tables").update({ status: "occupied" }).eq("id", table.id);
  }

  return jsonResponse(
    {
      restaurant: table.restaurant,
      table: { id: table.id, table_number: table.table_number, smoking_allowed: table.smoking_allowed },
      session,
    },
    200,
  );
});
