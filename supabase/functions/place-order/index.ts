// POST /functions/v1/place-order
// API Specification §7.1 — Backend Schema §11.1
//
// Auth: any signed-in registered session participant (see join-session's own
// note on why anonymous access is rejected). Creates an order + its items +
// modifiers and deducts JIT inventory, all atomically via the
// place_order_transaction() SQL function (20260914093000) — this Edge
// Function's own job is auth, request validation, and required-modifier-
// group enforcement; the DB function is the only place doing the actual
// writes, so a stock failure can never leave a partial order behind.
//
// Request body:
// { "session_id": "uuid", "participant_id": "uuid",
//   "items": [{ "dish_id": "uuid", "quantity": 2,
//               "dish_size_option_id": "uuid | null",
//               "modifier_option_ids": ["uuid", ...] }] }
// Supersedes the API Specification's earlier free-form jsonb `modifiers`
// placeholder (marked "טרם ממוגרר" in the doc) now that dish_modifier_groups/
// dish_modifier_options/order_item_modifiers actually exist (2026-09-12).

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

interface RequestItem {
  dish_id: string;
  quantity: number;
  dish_size_option_id: string | null;
  modifier_option_ids: string[];
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
  const participantId = body?.participant_id;
  if (typeof participantId !== "string" || participantId === "") {
    return errorResponse("MISSING_REQUIRED_FIELD", "Missing or invalid field: participant_id", 400);
  }
  const rawItems = body?.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return errorResponse("MISSING_REQUIRED_FIELD", "items must be a non-empty array", 400);
  }

  const items: RequestItem[] = [];
  for (const raw of rawItems) {
    const item = raw as Record<string, unknown>;
    if (typeof item?.dish_id !== "string" || item.dish_id === "") {
      return errorResponse("MISSING_REQUIRED_FIELD", "Each item requires a dish_id", 400);
    }
    const quantity = typeof item.quantity === "number" ? item.quantity : 1;
    if (!Number.isInteger(quantity) || quantity < 1) {
      return errorResponse("MISSING_REQUIRED_FIELD", "quantity must be a positive integer", 400);
    }
    const sizeOptionId = item.dish_size_option_id;
    if (sizeOptionId !== undefined && sizeOptionId !== null && typeof sizeOptionId !== "string") {
      return errorResponse("MISSING_REQUIRED_FIELD", "Invalid field: dish_size_option_id", 400);
    }
    const modifierIds = item.modifier_option_ids;
    if (modifierIds !== undefined && !Array.isArray(modifierIds)) {
      return errorResponse("MISSING_REQUIRED_FIELD", "Invalid field: modifier_option_ids", 400);
    }
    items.push({
      dish_id: item.dish_id,
      quantity,
      dish_size_option_id: (sizeOptionId as string | null) ?? null,
      modifier_option_ids: (modifierIds as string[] | undefined) ?? [],
    });
  }

  // Caller must actually be the participant they claim to be placing this
  // order for — same "resolve the caller's own row, don't trust a bare ID"
  // pattern as join-session's qr_token check.
  const { data: participant, error: participantError } = await admin
    .from("session_participants")
    .select("id, session_id, user_id")
    .eq("id", participantId)
    .maybeSingle();
  if (participantError || !participant || participant.user_id !== callerId || participant.session_id !== sessionId) {
    return errorResponse("FORBIDDEN", "Caller is not this session's participant", 403);
  }

  // Required-modifier-group enforcement — the one piece of business logic
  // this Edge Function owns rather than the SQL function (which trusts its
  // caller to have already checked this, matching how join-session validates
  // before ever touching the DB's insert path).
  for (const item of items) {
    const { data: groups } = await admin
      .from("dish_modifier_groups")
      .select("id, selection_type, is_required")
      .eq("dish_id", item.dish_id)
      .eq("is_required", true);
    if (!groups || groups.length === 0) continue;

    const { data: options } = await admin
      .from("dish_modifier_options")
      .select("id, group_id")
      .in("group_id", groups.map((g) => g.id));
    const optionToGroup = new Map((options ?? []).map((o) => [o.id, o.group_id]));

    for (const group of groups) {
      const selectedInGroup = item.modifier_option_ids.filter((id) => optionToGroup.get(id) === group.id);
      if (selectedInGroup.length === 0) {
        return errorResponse("MISSING_REQUIRED_MODIFIER", `Dish ${item.dish_id} requires a selection for a required modifier group`, 422);
      }
    }
  }

  const { data: result, error: rpcError } = await admin
    .rpc("place_order_transaction", {
      p_session_id: sessionId,
      p_participant_id: participantId,
      p_items: items.map((i) => ({
        dish_id: i.dish_id,
        quantity: i.quantity,
        dish_size_option_id: i.dish_size_option_id,
        modifier_option_ids: i.modifier_option_ids,
      })),
    })
    .single();

  if (rpcError) {
    const message = rpcError.message ?? "";
    if (message.includes("SESSION_NOT_OPEN")) {
      return errorResponse("SESSION_NOT_OPEN", "The session is not open for orders", 409);
    }
    if (message.includes("DISH_NOT_AVAILABLE")) {
      return errorResponse("DISH_NOT_AVAILABLE", "One or more dishes are not available", 422);
    }
    if (message.includes("Insufficient stock")) {
      return errorResponse("INSUFFICIENT_STOCK", "One or more required ingredients are out of stock", 409);
    }
    console.error("place-order RPC failed", rpcError);
    return errorResponse("INTERNAL_ERROR", "Failed to place order", 500);
  }

  const orderId = (result as { order_id: string; inventory_alerts: { ingredient_id: string; below_threshold: boolean }[] }).order_id;
  const inventoryAlerts = (result as { order_id: string; inventory_alerts: { ingredient_id: string; below_threshold: boolean }[] }).inventory_alerts;

  const { data: order } = await admin
    .from("orders")
    .select("id, status, placed_at, bar_ticket_number")
    .eq("id", orderId)
    .single();
  const { data: orderItems } = await admin
    .from("order_items")
    .select("id, dish_id, status")
    .eq("order_id", orderId);

  return jsonResponse(
    {
      order,
      items: orderItems ?? [],
      inventory_alerts: inventoryAlerts ?? [],
    },
    201,
  );
});
