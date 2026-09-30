export * from './database.types';

import type { Database, Tables, TablesInsert, TablesUpdate } from './database.types';

// Convenience per-table aliases so consumers can write `Restaurant`
// instead of `Tables<'restaurants'>` everywhere.
export type Restaurant = Tables<'restaurants'>;
export type FeedstarsTier = Tables<'feedstars_tiers'>;
export type UserProfile = Tables<'user_profiles'>;
export type Staff = Tables<'staff'>;
export type Consent = Tables<'consents'>;
export type MenuCategory = Tables<'menu_categories'>;
export type MenuCategoryLike = Tables<'menu_category_likes'>;
export type Dish = Tables<'dishes'>;
export type DishLike = Tables<'dish_likes'>;
export type DishSizeOption = Tables<'dish_size_options'>;
export type DishModifierGroup = Tables<'dish_modifier_groups'>;
export type DishModifierOption = Tables<'dish_modifier_options'>;
export type ModifierOptionIngredient = Tables<'modifier_option_ingredients'>;
export type ModifierOptionServingVariant = Tables<'modifier_option_serving_variants'>;
export type Ingredient = Tables<'ingredients'>;
export type IngredientUnit = Tables<'ingredient_units'>;
export type DishIngredient = Tables<'dish_ingredients'>;
export type PurchaseOrder = Tables<'purchase_orders'>;
export type RestaurantTable = Tables<'tables'>;
export type TableSession = Tables<'table_sessions'>;
export type SessionParticipant = Tables<'session_participants'>;
export type Order = Tables<'orders'>;
export type OrderItem = Tables<'order_items'>;
export type OrderItemModifier = Tables<'order_item_modifiers'>;
export type OrderHold = Tables<'order_holds'>;
export type Payment = Tables<'payments'>;
export type PaymentParticipantShare = Tables<'payment_participant_shares'>;
export type Review = Tables<'reviews'>;
export type ReviewDishRating = Tables<'review_dish_ratings'>;
export type ReviewHelpfulVote = Tables<'review_helpful_votes'>;
export type NonConformance = Tables<'non_conformances'>;
export type WaiterCall = Tables<'waiter_calls'>;
export type Notification = Tables<'notifications'>;
export type AuditLog = Tables<'audit_log'>;
export type OverheadExpense = Tables<'overhead_expenses'>;

// list_restaurant_staff() RPC row — not a table, so not covered by Tables<>.
export type StaffDirectoryRow = Database['public']['Functions']['list_restaurant_staff']['Returns'][number];

export type { TablesInsert, TablesUpdate };
