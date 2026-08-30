-- Feedbook Backend Schema — Performance indexes
-- Source: 5.Feedbook_Backend_Schema.docx §12
-- Note: unique indexes on qr_code_token, session_account_number, and
-- (restaurant_id, sku) already exist implicitly from the UNIQUE constraints
-- declared in the table DDL — no separate index needed for those.

-- restaurant_id indexes — used by both RLS subqueries and everyday
-- Web Admin queries, on every table that carries a direct restaurant_id column.
create index idx_staff_restaurant_id on staff (restaurant_id);
create index idx_menu_categories_restaurant_id on menu_categories (restaurant_id);
create index idx_dishes_restaurant_id on dishes (restaurant_id);
create index idx_ingredients_restaurant_id on ingredients (restaurant_id);
create index idx_purchase_orders_restaurant_id on purchase_orders (restaurant_id);
create index idx_tables_restaurant_id on tables (restaurant_id);
create index idx_table_sessions_restaurant_id on table_sessions (restaurant_id);
create index idx_reviews_restaurant_id on reviews (restaurant_id);
create index idx_non_conformances_restaurant_id on non_conformances (restaurant_id);
create index idx_audit_log_restaurant_id on audit_log (restaurant_id);

-- Kitchen real-time tracking queries (AFD #2.3)
create index idx_order_items_order_id_status on order_items (order_id, status);

-- Fast lookup of open table sessions
create index idx_table_sessions_restaurant_id_status on table_sessions (restaurant_id, status);

-- Published-reviews listing
create index idx_reviews_restaurant_id_status on reviews (restaurant_id, status);
