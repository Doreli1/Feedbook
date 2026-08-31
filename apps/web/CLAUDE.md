# apps/web — Feedbook Web Admin

React Admin app for restaurant owners/staff: menu, inventory, tables, orders,
payments, reports, non-conformances, and restaurant self-registration. Screen
inventory and flows: `../../../2.Feedbook_App_Flow v2.docx` Part B (§3). Feature specs:
`../../../1.PRD_restaurant_system_v5.docx` §5.1.

Scaffolded (2026-08-31): React 19 + Vite 7 + TypeScript + Tailwind v4, placeholder
screen only — no real UI built yet.

## Stack

React 19, Vite 7 (pinned deliberately — Vite 8's Rolldown native binary got blocked by
Windows Smart App Control on the dev machine; if the same class of issue resurfaces
with any other native dependency, look at the `rollup` → `@rollup/wasm-node` pnpm
override in `pnpm-workspace.yaml` for the pattern that fixed it), TypeScript, Tailwind
CSS v4, TanStack Query/Router (not yet installed). Rationale for Vite over Next.js (no
public SEO surface needed): Tech Stack Doc §4.1.

## Commands

```bash
pnpm --filter @feedbook/web dev
pnpm --filter @feedbook/web build
pnpm --filter @feedbook/web typecheck
pnpm --filter @feedbook/web lint       # oxlint
pnpm --filter @feedbook/web test       # Vitest — not yet set up
pnpm --filter @feedbook/web test:e2e   # Playwright — not yet set up
```

## Module → source-of-truth map

| Module | Screens | Data | API |
|---|---|---|---|
| Restaurant self-registration | AFD §3.7 | Backend Schema §1.2, §2.4, §10.2, §11.3 | API Spec §4.2–4.3 |
| Menu & inventory (incl. kosher upload) | AFD §3.2 | Backend Schema §3 | API Spec §5 |
| Tables & QR | AFD §3.2 | Backend Schema §4 | API Spec §6 |
| Orders / kitchen view | AFD §3.3 | Backend Schema §5 | API Spec §7.3 |
| Reports, non-conformances, RBAC | AFD §3.2 | Backend Schema §8 | API Spec §10 |

## Rules specific to this app

- Never gate a sensitive action (price change, refund, closing a non-conformance) on
  a client-side role check alone — RLS + `staff.role` on the server is the real
  boundary. The UI check is only for UX, not security.
- Staff sign-in requires MFA (TOTP) — don't build a path that skips it. This is the
  current blocking piece of work (Implementation Plan Stage 1 gate) before any other
  real screen gets built.
- A new restaurant has no `staff` row yet, so it can't go through the normal
  staff-scoped RLS path — registration goes through the `register-restaurant` Edge
  Function (service_role), not a direct client insert. Backend Schema §11.3.
- Copy: professional/compact register, not the warm consumer tone used in the mobile
  app. See Content Guidelines §1.1, §2.9, §2.10 (registration-flow copy specifically).
- File uploads (kosher certificate) accept image or PDF, max size per Content
  Guidelines §5.1 — validate both client- and server-side.
