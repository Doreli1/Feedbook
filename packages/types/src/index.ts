export * from './database.types';

import type { Tables, TablesInsert, TablesUpdate } from './database.types';

// Convenience per-table aliases so consumers can write `Restaurant`
// instead of `Tables<'restaurants'>` everywhere.
export type Restaurant = Tables<'restaurants'>;
export type FeedstarsTier = Tables<'feedstars_tiers'>;
export type UserProfile = Tables<'user_profiles'>;
export type Staff = Tables<'staff'>;
export type Consent = Tables<'consents'>;
export type MenuCategory = Tables<'menu_categories'>;
export type Dish = Tables<'dishes'>;
export type DishLike = Tables<'dish_likes'>;
export type Ingredient = Tables<'ingredients'>;
export type DishIngredient = Tables<'dish_ingredients'>;
export type PurchaseOrder = Tables<'purchase_orders'>;
export type RestaurantTable = Tables<'tables'>;
export type TableSession = Tables<'table_sessions'>;
export type SessionParticipant = Tables<'session_participants'>;
export type Order = Tables<'orders'>;
export type OrderItem = Tables<'order_items'>;
export type Payment = Tables<'payments'>;
export type PaymentParticipantShare = Tables<'payment_participant_shares'>;
export type Review = Tables<'reviews'>;
export type ReviewDishRating = Tables<'review_dish_ratings'>;
export type ReviewHelpfulVote = Tables<'review_helpful_votes'>;
export type NonConformance = Tables<'non_conformances'>;
export type WaiterCall = Tables<'waiter_calls'>;
export type Notification = Tables<'notifications'>;
export type AuditLog = Tables<'audit_log'>;

export type { TablesInsert, TablesUpdate };
