-- Raise dishes.description's max length from 200 to 400 chars.
-- Backend Schema §3 originally specified 200; product direction (2026-09-02)
-- raised it for the menu-builder screen (AFD §3.7.1 screen 4).
alter table dishes drop constraint dishes_description_check;
alter table dishes add constraint dishes_description_check check (char_length(description) <= 400);
