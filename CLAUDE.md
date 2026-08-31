# Feedbook — Root Guide for Claude Code

Feedbook is a two-sided platform for the restaurant industry: a Web Admin app for
restaurant owners/staff, and a mobile app for diners (QR-based table entry, ordering,
split payment, reviews). Vision, features, and roadmap: `../1.PRD_restaurant_system_v5.docx`.

## Repo status (updated 2026-08-31)

Monorepo is scaffolded and working: `apps/web` (React + Vite + Tailwind), `apps/mobile`
(Expo + NativeWind), `packages/types` (Supabase-generated DB types — Zod validation
schemas not yet added, see "Known gaps" below). CI is green on GitHub Actions
(`.github/workflows/ci.yml`: typecheck, lint, build, `pnpm audit`). The Supabase schema
is fully built and validated — 26 tables, 45+ RLS policies, 3 PL/pgSQL functions — both
locally (Docker) and on the real Frankfurt Cloud project. No Edge Functions exist yet.
No real UI screens exist yet — both apps still show placeholder text. Auth + MFA for
Web Admin staff is the next blocking piece before real UI work starts (Implementation
Plan §5, Stage 1 gate).

## Tech stack (facts you can't guess from the code)

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Web Admin | React 19, Vite 7, TypeScript, Tailwind CSS v4, TanStack Query/Router (not yet installed); shadcn/ui not yet added |
| Mobile | React Native, **Expo Managed** (do not eject/prebuild without team discussion), NativeWind |
| Backend | Supabase (Postgres, Auth, Storage, Realtime), Edge Functions in TypeScript/Deno |
| Critical business logic | PL/pgSQL functions (JIT stock deduction, bill split) — never reimplement these in app code |
| Payments | Tranzila, Hosted Fields — card data never touches our servers |
| Hosting | Vercel (Web — project `feedbook-web` created, root `app/apps/web`, no production deployment yet), EAS (Mobile, not yet configured), Supabase Cloud — region **Frankfurt (EU)**, not negotiable |
| Full rationale | `../3.Feedbook_Tech_Stack_Document_v4.docx` |

## Actual directory layout

```
apps/web/              React Admin app            → apps/web/CLAUDE.md
apps/mobile/            React Native app           → apps/mobile/CLAUDE.md
supabase/
  migrations/           SQL migrations, applied — schema source of truth
  functions/            Edge Functions (none written yet) → supabase/functions/CLAUDE.md
packages/types/         Supabase-generated DB types (Zod schemas: still pending)
packages/config/        Empty placeholder — shared eslint/tailwind config, not started
```

## Where things are documented (don't duplicate, link)

| Need | Source |
|---|---|
| Full feature list, MVP scope, out-of-scope | `../1.PRD_restaurant_system_v5.docx` §5, §9 |
| Screen-by-screen flows, wireframes, sitemap | `../2.Feedbook_App_Flow v2.docx` |
| Every table, column, constraint, RLS pattern | `../5.Feedbook_Backend_Schema.docx` |
| Visual ERDs + relationship cardinality | `../5.1.Feedbook_ER_Diagrams.docx` |
| Every API endpoint, request/response shape | `../7.Feedbook_API_Specification_v1.docx` |
| Voice, tone, terminology, moderation rules | `../4.Feedbook_Content_Guidelines v2.docx` |
| Build order, security gates, test types per phase | `../6.Feedbook_Implementation_Plan.docx` |

Read the relevant section before implementing a feature — don't guess field names or
endpoint shapes; they're already fully specified.

## Non-negotiable rules

- **Every business table gets `restaurant_id` + RLS enabled.** No table ships without
  RLS. See Backend Schema §10. (The initial schema build shipped table-creation and RLS
  as separate migrations, applied together in the same session — a one-time exception,
  not the pattern to repeat. New tables should enable RLS in the same migration that
  creates them.)
- **JIT stock deduction and bill-split math live only in the PL/pgSQL functions**
  (`deduct_inventory_for_order`, `calculate_bill_split` — Backend Schema §11), called
  via `SELECT ... FOR UPDATE`. Never recompute these in TypeScript.
- **Never commit secrets.** `service_role` key, Tranzila keys — env vars only
  (`.env.local`, gitignored from the first commit). `service_role` must never reach
  client code.
- **Kosher status is self-declared, unverified.** Every screen showing it must carry
  the fixed disclaimer text from Content Guidelines §7.2א — it is not optional and not
  restaurant-editable.
- **UI copy**: pull terms from Content Guidelines §3 (bilingual glossary) verbatim.
  Don't invent alternate phrasing for existing concepts (e.g. always "Split Evenly" /
  "Split by Item", never a synonym).
- **Payments**: PCI scope is SAQ-A. If a change would make card data touch our
  servers/logs even transiently, stop and flag it — don't implement it.
- **A restaurant's first `staff` row (manager) can't be created through normal
  staff-scoped RLS** — that policy requires already being staff, which is impossible
  for a brand-new restaurant. Registration goes through `register-restaurant`
  (service_role), not a direct client insert. Backend Schema §11.3, API Spec §4.2.

## Known gaps (as of 2026-08-31)

- `packages/types` has DB-generated types only — the Zod validation-schema layer for
  Edge Function request bodies has not been built yet.
- No Edge Functions exist yet — `supabase/functions/` is empty. `register-restaurant`
  is the first one needed (API Spec §4.2).
- No real UI has been built in either app — both show placeholder screens.
- `Pass.txt` (repo root, outside `app/`) still holds mostly-unrotated original secrets
  from before the Supabase project migration to Frankfurt — service_role/Gemini/Resend
  keys need rotating and the file deleted once that's done.
- No `packages/config` (shared eslint/tailwind config) yet — just a placeholder.

## MCP connectors available in this environment

- **Supabase** — connected, authenticated. Project `Feedbook-EU` (region eu-central-1 /
  Frankfurt, ref `xekiayczikqeypwupvbi`) exists and holds the full schema. An older
  Singapore project (`yqwfsimqqpsognbkbjzk`) is paused, pending manual deletion.
- **Vercel** — connected (team: `doreli125-7289's projects`, Hobby plan). Project
  `feedbook-web` exists, linked to this repo with root directory `app/apps/web`. Note:
  this project is invisible to the Vercel MCP tools here (`get_project`/`list_projects`
  return empty/404 for it even though the dashboard shows it — a real, unresolved
  inconsistency, not a transient one). Manage it via the Vercel dashboard directly
  until that's understood. Upgrade to Pro before production (Hobby is non-commercial).
- Ask before creating or deleting a project in either; both are consequential/costly
  actions even though doable directly via MCP tools.

## Terminology map (Hebrew UI ↔ code)

| UI shows (Hebrew) | Code / DB identifier |
|---|---|
| מאושרת כשרות / לא מאושרת כשרות | `restaurants.kosher_status` = `'certified'` / `'not_certified'` |
| שולחן וירטואלי | `table_sessions` row |
| חלוקה כללית / חלוקה אישית | `payments.split_type` = `'even'` / `'by_item'` |
| תוכנית Genius | `genius_tiers`, `user_profiles.genius_tier_id` — **name pending legal review**, see PRD §13.3 |
| אי-התאמה | `non_conformances` |
| הרשמת מסעדה עצמאית | `restaurants.onboarding_status` (`draft`/`pending_review`/`approved`/`rejected`) — approval is a manual step during the pilot, not an endpoint. AFD §3.7, Backend Schema §1.2/§2.4/§10.2/§11.3, API Spec §4.2–4.3 |
