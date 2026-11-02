import { FunctionsHttpError } from '@supabase/supabase-js';

// supabase-js's functions.invoke() never puts an Edge Function's own JSON
// error body into `data` when the function responds with a non-2xx status
// (every documented error in this app's API — 401/403/404/409/422/500 — is
// returned that way, never as 200 with an error payload): the client's
// FunctionsClient.invoke() throws FunctionsHttpError(response) instead and
// leaves `data` as null. The body is only reachable via error.context, a
// Response object that still needs its own .json() call. Every call site
// that read `data?.error?.code` after checking `error` was therefore dead
// code — the branch never matched, so every specific error (INSUFFICIENT_STOCK,
// EDIT_WINDOW_EXPIRED, TABLE_NOT_ACTIVE, ...) silently fell through to the
// generic fallback message instead of its real one (found 2026-09-19, while
// the user was deliberately trying to trigger an insufficient-stock error).
// Extended 2026-11-02 to also surface an error's `details` (e.g.
// RESTAURANT_NOT_ACTIVE/BAR_NOT_ACTIVE carrying the hours to show) — a
// Response body can only be read once, so resolveTableToken.ts needs code
// and details from the same call rather than reading .json() twice.
export async function extractFunctionError(error: unknown): Promise<{ code?: string; details?: Record<string, unknown> }> {
  if (!(error instanceof FunctionsHttpError)) return {};
  try {
    const body = (await error.context.json()) as { error?: { code?: string; details?: Record<string, unknown> } };
    return { code: body?.error?.code, details: body?.error?.details };
  } catch {
    return {};
  }
}

export async function extractFunctionErrorCode(error: unknown): Promise<string | undefined> {
  return (await extractFunctionError(error)).code;
}
