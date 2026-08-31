@AGENTS.md

# apps/mobile — Feedbook (diner app)

React Native app: QR entry, table session, ordering, split payment, reviews, Genius
tier. Screen inventory and flows: `../../../2.Feedbook_App_Flow v2.docx` Part A (§2).
Feature specs: `../../../1.PRD_restaurant_system_v5.docx` §5.2.

Scaffolded (2026-08-31): Expo ~57 (Managed) + NativeWind v4, placeholder screen only —
no real UI or feature work started. This app is intentionally last in build order
(Implementation Plan Stage 4) — don't start real feature work here before Web Admin's
Auth+MFA and restaurant registration are done, per the plan's own build order.

## Stack

React Native, **Expo Managed workflow** — stay managed; don't run `expo prebuild` or
add a native module without discussing it first (Tech Stack Doc §4.2 explains why:
camera, push, biometrics, and OTA updates all work without ejecting). NativeWind for
styling. Expo Router / Zustand: not yet installed.

## Commands

```bash
pnpm --filter @feedbook/mobile start
pnpm --filter @feedbook/mobile typecheck
pnpm --filter @feedbook/mobile test        # Jest — not yet set up
pnpm --filter @feedbook/mobile test:e2e    # Maestro/Detox — not yet set up
eas build --platform all                   # not yet configured
```

## Flow → source-of-truth map

| Flow | AFD | API |
|---|---|---|
| QR scan → restaurant details (incl. kosher badge) | §2.1, §2.2א | §6.1 |
| Seating, add friends to table | §2.1 | §6.2 |
| Menu browse, order, kitchen status | §2.3 | §7 |
| Payment, split evenly/by item | §2.5 | §8 |
| Review verification (email code) | §2.6 | §9.1–9.2 |
| Waiter call | §3.6 | §10.1 |

## Rules specific to this app

- Kosher certificate viewer: images via a plain JS zoom component, PDFs via WebView
  pointing at the Supabase Storage URL — no native PDF module (Tech Stack Doc §4.7).
- Contacts access requires the explicit consent screen first; log the grant to
  `consents` before reading the device contact list (Content Guidelines §5.1א).
- Payment confirmation requires biometric auth before calling
  `confirm-participant-payment` — never skip this even in dev builds against sandbox.
- Copy: warm, human, second person — see Content Guidelines §1.1–§1.3. Never joke in
  payment or error screens (§2.5, §2.8).
- Every new error state needs a dedicated screen per AFD §5 — no bare "Error" text.
