// POST /functions/v1/register-restaurant
// API Specification §4.2 — Backend Schema §11.3
//
// Auth: any signed-in user (Bearer token). Creates, atomically, a new
// restaurant (onboarding_status='draft') and the caller's first `staff` row
// (role='manager'), by calling register_restaurant() under service_role.
// That RPC is revoked from `authenticated`/`anon` — this function is the
// only caller. Called once, right after the user signs in at wizard screen 1
// (AFD §3.7.1) — merchant agreement acceptance happens later, at screen 5,
// as a direct staff-scoped client insert (see the migration's comment on
// merchant_agreement_acceptances' insert policy for why it isn't bundled
// into this call).

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

const KOSHER_STATUS_VALUES = ["certified", "not_certified"] as const;

interface RegisterRestaurantBody {
  name: string;
  address: string;
  phone: string;
  hours?: Record<string, unknown> | null;
  kosher_status: (typeof KOSHER_STATUS_VALUES)[number];
}

function validateBody(body: unknown): { ok: true; value: RegisterRestaurantBody } | { ok: false; field: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, field: "body" };
  }
  const b = body as Record<string, unknown>;

  for (const field of ["name", "address", "phone", "kosher_status"]) {
    if (typeof b[field] !== "string" || b[field] === "") {
      return { ok: false, field };
    }
  }
  if (!KOSHER_STATUS_VALUES.includes(b.kosher_status as never)) {
    return { ok: false, field: "kosher_status" };
  }
  if (b.hours !== undefined && b.hours !== null && typeof b.hours !== "object") {
    return { ok: false, field: "hours" };
  }

  return {
    ok: true,
    value: {
      name: b.name as string,
      address: b.address as string,
      phone: b.phone as string,
      hours: (b.hours as Record<string, unknown> | null | undefined) ?? {},
      kosher_status: b.kosher_status as (typeof KOSHER_STATUS_VALUES)[number],
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
  const userId = userData.user.id;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse("MISSING_REQUIRED_FIELD", "Request body must be valid JSON", 400);
  }

  const validated = validateBody(rawBody);
  if (!validated.ok) {
    return errorResponse(
      "MISSING_REQUIRED_FIELD",
      `Missing or invalid field: ${validated.field}`,
      400,
    );
  }
  const { name, address, phone, hours, kosher_status } = validated.value;

  const { data: restaurantId, error: rpcError } = await admin.rpc("register_restaurant", {
    p_user_id: userId,
    p_name: name,
    p_address: address,
    p_phone: phone,
    p_hours: hours,
    p_kosher_status: kosher_status,
  });

  if (rpcError) {
    console.error("register_restaurant RPC failed", rpcError);
    return errorResponse("INTERNAL_ERROR", "Failed to register restaurant", 500);
  }

  return jsonResponse(
    { restaurant: { id: restaurantId, onboarding_status: "draft" } },
    201,
  );
});
