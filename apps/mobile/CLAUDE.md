@AGENTS.md

# apps/mobile — Feedbook (diner app)

React Native app: QR entry, table session, ordering, split payment, reviews, Genius
tier. Screen inventory and flows: `../../../2.Feedbook_App_Flow v2.docx` Part A (§2).
Feature specs: `../../../1.PRD_restaurant_system_v5.docx` §5.2.

Stage 4 (mobile core) build started 2026-09-07, Week 1 of the 4-week plan in
`Feedbook_UI_Milestone4_Mobile_Spec.docx` — see that doc for the full M-01..M-10 screen
map, copy, and week-by-week order; don't re-derive it from scratch. Real screens so far:
`app/index.tsx` (M-01 Splash, real), `app/sign-in.tsx` / `app/profile.tsx` (placeholder
stubs only — real M-02/M-03/M-04 land in Weeks 2–3). Shared components already real:
`src/components/ConfirmModal.tsx` (M-05 pattern), `ErrorModal.tsx` (M-09),
`SuccessToast.tsx` (M-10).

## Stack

React Native, **Expo Managed workflow** — stay managed; don't run `expo prebuild` or
add a native module without discussing it first (Tech Stack Doc §4.2 explains why:
camera, push, biometrics, and OTA updates all work without ejecting). NativeWind for
styling. Navigation: **expo-router** (file-based, `app/` directory — not
`@react-navigation` directly). State: zustand (installed, not yet used).

## Known infra gotcha — pnpm + Metro on Windows

`metro.config.js` needs the monorepo/pnpm block (`watchFolders`, `resolver.nodeModulesPaths`,
`unstable_enableSymlinks`, and an `extraNodeModules` Proxy fallback) — without it, bundling
fails with `Unable to resolve module "expo"` from deep inside `expo-router`'s own `.pnpm`
store, even though the symlink is real and valid on disk (confirmed via `ls -la`). Root
cause: Metro's directory crawler on Windows doesn't reliably pick up pnpm's symlinked
`node_modules` entries even with `unstable_enableSymlinks` on — `extraNodeModules` is what
actually closes the gap, by resolving any otherwise-unfound bare import straight to its
real path under the workspace root instead of relying on the crawler having indexed it.
Verified by actually building the Android and iOS bundles against the dev server (HTTP 200,
~10MB), not just by `tsc --noEmit` (which can't catch this class of bug at all). If a new
native/Expo package mysteriously fails to resolve later, check this block before assuming
the package itself is broken.

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
