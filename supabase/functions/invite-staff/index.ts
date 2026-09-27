// POST /functions/v1/invite-staff
// API Specification §4.4 — new for Users & Roles (PRD §5.1.7)
//
// Auth: Bearer token, caller must be an active manager of restaurant_id.
// Invites a brand-new staff member by email (Supabase Admin
// inviteUserByEmail — sends a real invite email, only callable with
// service_role) and inserts their `staff` row once the user id is known.
// Mirrors register-restaurant/index.ts's structure (CORS/JSON helpers,
// admin.auth.getUser(token) caller verification) rather than inventing a
// new shape.
//
// v1 scope, deliberately not solved here: if the email already belongs to
// an existing Feedbook account, inviteUserByEmail errors and this returns
// EMAIL_ALREADY_REGISTERED rather than resolving/reusing that user — doing
// that safely needs a decision on self-service staff joining, out of scope
// for this endpoint.

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

const ROLE_VALUES = ["manager", "waiter", "kitchen"] as const;

interface InviteStaffBody {
  restaurant_id: string;
  email: string;
  role: (typeof ROLE_VALUES)[number];
  first_name: string;
  last_name: string;
  phone: string | null;
}

function validateBody(body: unknown): { ok: true; value: InviteStaffBody } | { ok: false; field: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, field: "body" };
  }
  const b = body as Record<string, unknown>;

  if (typeof b.restaurant_id !== "string" || b.restaurant_id === "") {
    return { ok: false, field: "restaurant_id" };
  }
  if (typeof b.email !== "string" || !b.email.includes("@")) {
    return { ok: false, field: "email" };
  }
  if (!ROLE_VALUES.includes(b.role as never)) {
    return { ok: false, field: "role" };
  }
  if (typeof b.first_name !== "string" || b.first_name.trim() === "") {
    return { ok: false, field: "first_name" };
  }
  if (typeof b.last_name !== "string" || b.last_name.trim() === "") {
    return { ok: false, field: "last_name" };
  }
  if (b.phone !== undefined && b.phone !== null && typeof b.phone !== "string") {
    return { ok: false, field: "phone" };
  }

  return {
    ok: true,
    value: {
      restaurant_id: b.restaurant_id,
      email: b.email,
      role: b.role as InviteStaffBody["role"],
      first_name: b.first_name,
      last_name: b.last_name,
      phone: (b.phone as string | null | undefined) ?? null,
    },
  };
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

  const validated = validateBody(rawBody);
  if (!validated.ok) {
    return errorResponse("MISSING_REQUIRED_FIELD", `Missing or invalid field: ${validated.field}`, 400);
  }
  const { restaurant_id, email, role, first_name, last_name, phone } = validated.value;

  // service_role bypasses RLS, so the manager check has to be explicit here
  // — this is exactly what the "manager_manage_restaurant_staff" RLS policy
  // would otherwise enforce for a normal authenticated call.
  const { data: callerStaffRow } = await admin
    .from("staff")
    .select("id")
    .eq("user_id", callerId)
    .eq("restaurant_id", restaurant_id)
    .eq("role", "manager")
    .eq("is_active", true)
    .maybeSingle();

  if (!callerStaffRow) {
    return errorResponse("FORBIDDEN", "Caller is not an active manager of this restaurant", 403);
  }

  const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email);
  if (inviteError || !inviteData?.user) {
    if (inviteError?.message?.toLowerCase().includes("already")) {
      return errorResponse("EMAIL_ALREADY_REGISTERED", "This email already has a Feedbook account", 409);
    }
    console.error("inviteUserByEmail failed", inviteError);
    return errorResponse("INTERNAL_ERROR", "Failed to invite staff member", 500);
  }

  const { error: staffInsertError } = await admin.from("staff").insert({
    restaurant_id,
    user_id: inviteData.user.id,
    role,
    first_name,
    last_name,
    phone,
  });
  if (staffInsertError) {
    console.error("staff insert failed after invite", staffInsertError);
    return errorResponse("INTERNAL_ERROR", "Invited the user but failed to add them as staff", 500);
  }

  return jsonResponse({ staff: { user_id: inviteData.user.id, role, first_name, last_name, phone, is_active: true } }, 201);
});
