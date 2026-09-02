// POST   /functions/v1/upload-kashrut-certificate — API Specification §5.1
// DELETE /functions/v1/upload-kashrut-certificate — API Specification §5.2
//
// Auth: Bearer token, caller must be an active manager at the given
// restaurant_id (not just any staff member — matches the spec's FORBIDDEN
// error, and the DB check is the real boundary, not this function alone).
// All storage writes happen here under service_role; the bucket has no
// client-facing write policy (see the bucket's own migration comment).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.4";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
};

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
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

async function requireManager(
  admin: ReturnType<typeof createClient>,
  userId: string,
  restaurantId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("staff")
    .select("id")
    .eq("user_id", userId)
    .eq("restaurant_id", restaurantId)
    .eq("role", "manager")
    .eq("is_active", true)
    .maybeSingle();
  return !error && !!data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
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

  if (req.method === "POST") {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return errorResponse("MISSING_REQUIRED_FIELD", "Request must be multipart/form-data", 400);
    }

    const restaurantId = form.get("restaurant_id");
    const file = form.get("file");
    if (typeof restaurantId !== "string" || !restaurantId) {
      return errorResponse("MISSING_REQUIRED_FIELD", "Missing restaurant_id", 400);
    }
    if (!(file instanceof File)) {
      return errorResponse("MISSING_REQUIRED_FIELD", "Missing file", 400);
    }

    if (!(await requireManager(admin, userId, restaurantId))) {
      return errorResponse("FORBIDDEN", "המשתמש אינו מנהל במסעדה זו", 403);
    }

    const ext = MIME_TO_EXT[file.type];
    if (!ext) {
      return errorResponse("UNSUPPORTED_FILE_TYPE", "פורמט קובץ לא נתמך (רק JPG/PNG/PDF)", 400);
    }
    if (file.size > MAX_FILE_BYTES) {
      return errorResponse("FILE_TOO_LARGE", "קובץ גדול מ-10MB", 400);
    }

    const path = `${restaurantId}/kosher-certificate.${ext}`;
    const { error: uploadError } = await admin.storage
      .from("restaurant-documents")
      .upload(path, file, { contentType: file.type, upsert: true });
    if (uploadError) {
      console.error("storage upload failed", uploadError);
      return errorResponse("INTERNAL_ERROR", "Upload failed", 500);
    }

    // Built manually rather than via storage.getPublicUrl(), which uses the
    // admin client's own SUPABASE_URL — the *internal* Docker-network
    // address locally (http://kong:8000), unreachable from a real browser.
    // See supabase/functions/.env for why PUBLIC_SUPABASE_URL exists.
    const publicBaseUrl = Deno.env.get("PUBLIC_SUPABASE_URL") ?? supabaseUrl;
    const publicUrl = `${publicBaseUrl}/storage/v1/object/public/restaurant-documents/${path}`;
    const uploadedAt = new Date().toISOString();

    const { error: updateError } = await admin
      .from("restaurants")
      .update({
        kosher_status: "certified",
        kosher_certificate_url: publicUrl,
        kosher_certificate_uploaded_at: uploadedAt,
      })
      .eq("id", restaurantId);
    if (updateError) {
      console.error("restaurant update failed", updateError);
      return errorResponse("INTERNAL_ERROR", "Failed to update restaurant", 500);
    }

    return jsonResponse(
      { kosher_certificate_url: publicUrl, kosher_status: "certified", uploaded_at: uploadedAt },
      200,
    );
  }

  if (req.method === "DELETE") {
    let body: { restaurant_id?: string };
    try {
      body = await req.json();
    } catch {
      return errorResponse("MISSING_REQUIRED_FIELD", "Request body must be valid JSON", 400);
    }
    const restaurantId = body.restaurant_id;
    if (typeof restaurantId !== "string" || !restaurantId) {
      return errorResponse("MISSING_REQUIRED_FIELD", "Missing restaurant_id", 400);
    }

    if (!(await requireManager(admin, userId, restaurantId))) {
      return errorResponse("FORBIDDEN", "המשתמש אינו מנהל במסעדה זו", 403);
    }

    // Try every extension we might have stored — cheaper than reading the
    // current URL back first, and removing a nonexistent path is a no-op.
    const paths = Object.values(MIME_TO_EXT).map((ext) => `${restaurantId}/kosher-certificate.${ext}`);
    await admin.storage.from("restaurant-documents").remove(paths);

    const { error: updateError } = await admin
      .from("restaurants")
      .update({ kosher_status: "not_certified", kosher_certificate_url: null, kosher_certificate_uploaded_at: null })
      .eq("id", restaurantId);
    if (updateError) {
      console.error("restaurant update failed", updateError);
      return errorResponse("INTERNAL_ERROR", "Failed to update restaurant", 500);
    }

    return jsonResponse({ kosher_status: "not_certified" }, 200);
  }

  return errorResponse("METHOD_NOT_ALLOWED", "Only POST and DELETE are supported", 405);
});
