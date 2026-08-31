# supabase/ — Database, RLS, Edge Functions

Schema source of truth: `../../../5.Feedbook_Backend_Schema.docx` (26 tables, all DDL
in §14). Visual ERDs: `../../../5.1.Feedbook_ER_Diagrams.docx`. Endpoint contracts:
`../../../7.Feedbook_API_Specification_v1.docx`.

## Status (updated 2026-08-31)

Project exists: `Feedbook-EU`, region eu-central-1 (Frankfurt), ref
`xekiayczikqeypwupvbi`. Full schema applied and validated both locally (Docker) and on
that project — 26 tables, 45+ RLS policies, 3 functions (`deduct_inventory_for_order`,
`calculate_bill_split`, `current_staff_restaurant_ids`). **No Edge Functions written
yet** — this folder is still empty.

## Commands

```bash
supabase start                          # local Postgres + services, requires Docker
supabase db reset                       # wipe + reapply all migrations locally
supabase migration new <name>           # new timestamped migration file
supabase functions deploy <name>        # not yet used
supabase test db                        # pgTAP tests — not yet set up
```

## Structure

```
migrations/     one file per schema change, in FK-dependency order (Backend Schema §0)
                — 13 migrations applied so far, see git log
functions/      one folder per Edge Function, named exactly as in API Spec §13
                (none written yet — register-restaurant is the first one needed,
                see API Spec §4.2)
```

## Non-negotiable rules

- **New tables should enable RLS and add their policies in the same migration file
  that creates them.** (The initial schema build shipped table-creation and RLS as
  separate migrations, applied together in the same session — a one-time exception,
  not the pattern to repeat.) Patterns: Staff-Scoped / Participant-Scoped /
  Public-Read — Backend Schema §10, API Spec §0.1.
- **`deduct_inventory_for_order` and `calculate_bill_split` are PL/pgSQL, not
  TypeScript**, and use `SELECT ... FOR UPDATE` row locking — Backend Schema §11.
  Any Edge Function touching orders or payments calls these; it doesn't reimplement
  their logic.
- Edge Function names, methods, and payload shapes must match API Spec §4–§10
  exactly — that document is the contract other apps are built against.
- `tranzila-webhook` must verify the signature before doing anything else and reject
  unsigned/invalid requests outright (API Spec §8.3).
- Log sensitive actions (price change, refund, non-conformance close) to `audit_log`
  in the same function call that performs them — not as an afterthought.
- Storage buckets: dish photos are public-read; `restaurant-documents` (kosher certs)
  is public-read but write-restricted to the owning restaurant's staff (Tech Stack
  Doc §4.7). Neither bucket has been created yet.
- A `SECURITY DEFINER` helper that other RLS policies rely on (like
  `current_staff_restaurant_ids()`) is easy to get subtly wrong with a blind
  find-and-replace across a migration file — a bulk edit once rewrote the function's
  own body to call itself, causing infinite recursion, and it wasn't caught by reading
  the SQL, only by actually querying as `anon`/`authenticated` after applying it. Any
  edit to a policy-supporting function needs to be re-verified the same way: apply it,
  then query as the actual roles, not just re-read the code.
