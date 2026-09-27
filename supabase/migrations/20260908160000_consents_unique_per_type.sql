-- A diner grants/revokes the same consent (contacts_access, marketing_notifications)
-- repeatedly over time (e.g. re-visiting the M-07 add-participants consent screen).
-- Without a uniqueness guarantee, the mobile app's upsert-on-consent-type pattern
-- would either fail (no matching ON CONFLICT target) or, if written as a plain
-- insert, silently accumulate a duplicate row per grant instead of updating the
-- one row that represents the user's current choice for that consent type.
alter table consents
  add constraint consents_user_id_consent_type_key unique (user_id, consent_type);
