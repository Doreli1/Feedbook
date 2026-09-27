-- Feedbook Backend Schema — staff contact fields
-- Users & Roles (PRD §5.1.7) needs a proper HR-style roster (first/last name,
-- phone) distinct from user_profiles.display_name (the diner-facing profile
-- a person controls for themselves) — these are records the restaurant
-- keeps about its own employee, editable by the manager, not the employee's
-- own profile data. Nullable: captured at invite time going forward, but
-- existing staff rows predate this and shouldn't be blocked by a NOT NULL
-- backfill requirement.
alter table staff
  add column first_name text,
  add column last_name text,
  add column phone text;
