export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          metadata: Json | null
          restaurant_id: string
          staff_id: string
        }
        Insert: {
          action: string
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          metadata?: Json | null
          restaurant_id: string
          staff_id: string
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          metadata?: Json | null
          restaurant_id?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      bar_ticket_counters: {
        Row: {
          last_number: number
          restaurant_id: string
        }
        Insert: {
          last_number?: number
          restaurant_id: string
        }
        Update: {
          last_number?: number
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bar_ticket_counters_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: true
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      consents: {
        Row: {
          consent_type: string
          granted: boolean
          granted_at: string
          id: string
          user_id: string
        }
        Insert: {
          consent_type: string
          granted: boolean
          granted_at?: string
          id?: string
          user_id: string
        }
        Update: {
          consent_type?: string
          granted?: boolean
          granted_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      dish_ingredients: {
        Row: {
          dish_id: string
          dish_size_option_id: string | null
          id: string
          ingredient_id: string
          is_critical: boolean
          quantity_required: number
          unit_id: string | null
        }
        Insert: {
          dish_id: string
          dish_size_option_id?: string | null
          id?: string
          ingredient_id: string
          is_critical?: boolean
          quantity_required: number
          unit_id?: string | null
        }
        Update: {
          dish_id?: string
          dish_size_option_id?: string | null
          id?: string
          ingredient_id?: string
          is_critical?: boolean
          quantity_required?: number
          unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dish_ingredients_dish_id_fkey"
            columns: ["dish_id"]
            isOneToOne: false
            referencedRelation: "dishes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dish_ingredients_dish_size_option_id_fkey"
            columns: ["dish_size_option_id"]
            isOneToOne: false
            referencedRelation: "dish_size_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dish_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dish_ingredients_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "ingredient_units"
            referencedColumns: ["id"]
          },
        ]
      }
      dish_likes: {
        Row: {
          created_at: string
          dish_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dish_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          dish_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dish_likes_dish_id_fkey"
            columns: ["dish_id"]
            isOneToOne: false
            referencedRelation: "dishes"
            referencedColumns: ["id"]
          },
        ]
      }
      dish_modifier_groups: {
        Row: {
          dish_id: string
          id: string
          is_required: boolean
          name: string
          selection_type: string
          sort_order: number
        }
        Insert: {
          dish_id: string
          id?: string
          is_required?: boolean
          name: string
          selection_type: string
          sort_order?: number
        }
        Update: {
          dish_id?: string
          id?: string
          is_required?: boolean
          name?: string
          selection_type?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "dish_modifier_groups_dish_id_fkey"
            columns: ["dish_id"]
            isOneToOne: false
            referencedRelation: "dishes"
            referencedColumns: ["id"]
          },
        ]
      }
      dish_modifier_options: {
        Row: {
          group_id: string
          id: string
          name: string
          photo_url: string | null
          price_delta: number
          sort_order: number
        }
        Insert: {
          group_id: string
          id?: string
          name: string
          photo_url?: string | null
          price_delta?: number
          sort_order?: number
        }
        Update: {
          group_id?: string
          id?: string
          name?: string
          photo_url?: string | null
          price_delta?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "dish_modifier_options_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "dish_modifier_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      dish_size_options: {
        Row: {
          dish_id: string
          id: string
          is_active: boolean
          name: string
          price: number
          sort_order: number
        }
        Insert: {
          dish_id: string
          id?: string
          is_active?: boolean
          name: string
          price: number
          sort_order?: number
        }
        Update: {
          dish_id?: string
          id?: string
          is_active?: boolean
          name?: string
          price?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "dish_size_options_dish_id_fkey"
            columns: ["dish_id"]
            isOneToOne: false
            referencedRelation: "dishes"
            referencedColumns: ["id"]
          },
        ]
      }
      dishes: {
        Row: {
          allergens: string[]
          category_id: string
          created_at: string
          description: string | null
          discount_percent: number
          feedstars_eligible: boolean
          guest_rating_score: number | null
          id: string
          is_available: boolean
          is_special_value: boolean
          likes_count: number
          name: string
          photo_urls: string[]
          prep_time_minutes: number | null
          price: number
          rating_avg: number | null
          rating_count: number
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          allergens?: string[]
          category_id: string
          created_at?: string
          description?: string | null
          discount_percent?: number
          feedstars_eligible?: boolean
          guest_rating_score?: number | null
          id?: string
          is_available?: boolean
          is_special_value?: boolean
          likes_count?: number
          name: string
          photo_urls?: string[]
          prep_time_minutes?: number | null
          price: number
          rating_avg?: number | null
          rating_count?: number
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          allergens?: string[]
          category_id?: string
          created_at?: string
          description?: string | null
          discount_percent?: number
          feedstars_eligible?: boolean
          guest_rating_score?: number | null
          id?: string
          is_available?: boolean
          is_special_value?: boolean
          likes_count?: number
          name?: string
          photo_urls?: string[]
          prep_time_minutes?: number | null
          price?: number
          rating_avg?: number | null
          rating_count?: number
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dishes_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dishes_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      feedstars_tiers: {
        Row: {
          benefits_description: string
          discount_percentage: number
          id: number
          min_activity_score: number
          tier_name: string
        }
        Insert: {
          benefits_description: string
          discount_percentage?: number
          id: number
          min_activity_score: number
          tier_name: string
        }
        Update: {
          benefits_description?: string
          discount_percentage?: number
          id?: number
          min_activity_score?: number
          tier_name?: string
        }
        Relationships: []
      }
      ingredient_units: {
        Row: {
          conversion_to_stock_unit: number
          id: string
          ingredient_id: string
          name: string
          sort_order: number
        }
        Insert: {
          conversion_to_stock_unit: number
          id?: string
          ingredient_id: string
          name: string
          sort_order?: number
        }
        Update: {
          conversion_to_stock_unit?: number
          id?: string
          ingredient_id?: string
          name?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "ingredient_units_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredients: {
        Row: {
          id: string
          name: string
          quantity_in_stock: number
          restaurant_id: string
          sku: string
          supplier_info: string | null
          threshold_quantity: number
          unit: string
          unit_cost: number | null
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          quantity_in_stock?: number
          restaurant_id: string
          sku: string
          supplier_info?: string | null
          threshold_quantity?: number
          unit: string
          unit_cost?: number | null
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          quantity_in_stock?: number
          restaurant_id?: string
          sku?: string
          supplier_info?: string | null
          threshold_quantity?: number
          unit?: string
          unit_cost?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingredients_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          id: string
          likes_count: number
          name: string
          restaurant_id: string
          section: string
          sort_order: number
        }
        Insert: {
          id?: string
          likes_count?: number
          name: string
          restaurant_id: string
          section?: string
          sort_order?: number
        }
        Update: {
          id?: string
          likes_count?: number
          name?: string
          restaurant_id?: string
          section?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_category_likes: {
        Row: {
          category_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_category_likes_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      merchant_agreement_acceptances: {
        Row: {
          accepted_at: string
          agreement_version: string
          id: string
          restaurant_id: string
          user_id: string
        }
        Insert: {
          accepted_at?: string
          agreement_version: string
          id?: string
          restaurant_id: string
          user_id: string
        }
        Update: {
          accepted_at?: string
          agreement_version?: string
          id?: string
          restaurant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "merchant_agreement_acceptances_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_option_ingredients: {
        Row: {
          ingredient_id: string
          modifier_option_id: string
          quantity_required: number
          unit_id: string | null
        }
        Insert: {
          ingredient_id: string
          modifier_option_id: string
          quantity_required: number
          unit_id?: string | null
        }
        Update: {
          ingredient_id?: string
          modifier_option_id?: string
          quantity_required?: number
          unit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "modifier_option_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_option_ingredients_modifier_option_id_fkey"
            columns: ["modifier_option_id"]
            isOneToOne: false
            referencedRelation: "dish_modifier_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modifier_option_ingredients_unit_id_fkey"
            columns: ["unit_id"]
            isOneToOne: false
            referencedRelation: "ingredient_units"
            referencedColumns: ["id"]
          },
        ]
      }
      non_conformances: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          created_at: string
          description: string | null
          id: string
          opened_by: string | null
          restaurant_id: string
          serial_code: string
          session_id: string | null
          status: string
          type: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          description?: string | null
          id?: string
          opened_by?: string | null
          restaurant_id: string
          serial_code: string
          session_id?: string | null
          status?: string
          type: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          description?: string | null
          id?: string
          opened_by?: string | null
          restaurant_id?: string
          serial_code?: string
          session_id?: string | null
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "non_conformances_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "non_conformances_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "non_conformances_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          id: string
          read_at: string | null
          related_order_id: string | null
          related_order_item_id: string | null
          sent_at: string
          staff_id: string | null
          title: string
          type: string
          user_id: string | null
        }
        Insert: {
          body: string
          id?: string
          read_at?: string | null
          related_order_id?: string | null
          related_order_item_id?: string | null
          sent_at?: string
          staff_id?: string | null
          title: string
          type: string
          user_id?: string | null
        }
        Update: {
          body?: string
          id?: string
          read_at?: string | null
          related_order_id?: string | null
          related_order_item_id?: string | null
          sent_at?: string
          staff_id?: string | null
          title?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_related_order_item_id_fkey"
            columns: ["related_order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      order_holds: {
        Row: {
          amount: number
          gateway_hold_ref: string | null
          held_at: string
          id: string
          order_id: string
          participant_id: string
          released_at: string | null
          status: string
        }
        Insert: {
          amount: number
          gateway_hold_ref?: string | null
          held_at?: string
          id?: string
          order_id: string
          participant_id: string
          released_at?: string | null
          status?: string
        }
        Update: {
          amount?: number
          gateway_hold_ref?: string | null
          held_at?: string
          id?: string
          order_id?: string
          participant_id?: string
          released_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_holds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_holds_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "session_participants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_item_modifiers: {
        Row: {
          modifier_option_id: string
          order_item_id: string
          price_delta_at_order: number
        }
        Insert: {
          modifier_option_id: string
          order_item_id: string
          price_delta_at_order: number
        }
        Update: {
          modifier_option_id?: string
          order_item_id?: string
          price_delta_at_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_item_modifiers_modifier_option_id_fkey"
            columns: ["modifier_option_id"]
            isOneToOne: false
            referencedRelation: "dish_modifier_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_item_modifiers_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          cancellation_reason: string | null
          cancellation_restocked: boolean | null
          dish_id: string
          dish_size_option_id: string | null
          id: string
          modifiers: Json | null
          order_id: string
          quantity: number
          status: string
          status_updated_at: string
          unit_price: number
        }
        Insert: {
          cancellation_reason?: string | null
          cancellation_restocked?: boolean | null
          dish_id: string
          dish_size_option_id?: string | null
          id?: string
          modifiers?: Json | null
          order_id: string
          quantity?: number
          status?: string
          status_updated_at?: string
          unit_price: number
        }
        Update: {
          cancellation_reason?: string | null
          cancellation_restocked?: boolean | null
          dish_id?: string
          dish_size_option_id?: string | null
          id?: string
          modifiers?: Json | null
          order_id?: string
          quantity?: number
          status?: string
          status_updated_at?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_dish_id_fkey"
            columns: ["dish_id"]
            isOneToOne: false
            referencedRelation: "dishes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_dish_size_option_id_fkey"
            columns: ["dish_size_option_id"]
            isOneToOne: false
            referencedRelation: "dish_size_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          bar_ticket_number: number | null
          id: string
          participant_id: string
          placed_at: string
          session_id: string
          status: string
          updated_at: string
        }
        Insert: {
          bar_ticket_number?: number | null
          id?: string
          participant_id: string
          placed_at?: string
          session_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          bar_ticket_number?: number | null
          id?: string
          participant_id?: string
          placed_at?: string
          session_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "session_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      overhead_expenses: {
        Row: {
          category: string
          id: string
          monthly_amount: number
          restaurant_id: string
          updated_at: string
        }
        Insert: {
          category: string
          id?: string
          monthly_amount?: number
          restaurant_id: string
          updated_at?: string
        }
        Update: {
          category?: string
          id?: string
          monthly_amount?: number
          restaurant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "overhead_expenses_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_participant_shares: {
        Row: {
          amount_due: number
          amount_paid: number
          id: string
          paid_at: string | null
          participant_id: string
          payment_id: string
          status: string
        }
        Insert: {
          amount_due: number
          amount_paid?: number
          id?: string
          paid_at?: string | null
          participant_id: string
          payment_id: string
          status?: string
        }
        Update: {
          amount_due?: number
          amount_paid?: number
          id?: string
          paid_at?: string | null
          participant_id?: string
          payment_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_participant_shares_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "session_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_participant_shares_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          id: string
          paid_at: string | null
          payment_gateway_ref: string | null
          receipt_number: string | null
          service_fee: number
          session_id: string
          split_type: string
          status: string
          total_amount: number
        }
        Insert: {
          id?: string
          paid_at?: string | null
          payment_gateway_ref?: string | null
          receipt_number?: string | null
          service_fee?: number
          session_id: string
          split_type: string
          status?: string
          total_amount: number
        }
        Update: {
          id?: string
          paid_at?: string | null
          payment_gateway_ref?: string | null
          receipt_number?: string | null
          service_fee?: number
          session_id?: string
          split_type?: string
          status?: string
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "payments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          created_at: string
          created_by: string
          id: string
          ingredient_id: string
          quantity_ordered: number
          received_at: string | null
          restaurant_id: string
          status: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          ingredient_id: string
          quantity_ordered: number
          received_at?: string | null
          restaurant_id: string
          status?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          ingredient_id?: string
          quantity_ordered?: number
          received_at?: string | null
          restaurant_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          address: string | null
          cancellation_window_minutes: number | null
          created_at: string
          created_by: string | null
          cuisine_tags: string[]
          description: string | null
          hours: Json | null
          id: string
          kosher_certificate_uploaded_at: string | null
          kosher_certificate_url: string | null
          kosher_status: string
          logo_url: string | null
          name: string
          onboarding_status: string
          phone: string | null
          rejection_reason: string | null
          reviewed_at: string | null
          submitted_at: string | null
          updated_at: string
          vat_rate_percent: number
        }
        Insert: {
          address?: string | null
          cancellation_window_minutes?: number | null
          created_at?: string
          created_by?: string | null
          cuisine_tags?: string[]
          description?: string | null
          hours?: Json | null
          id?: string
          kosher_certificate_uploaded_at?: string | null
          kosher_certificate_url?: string | null
          kosher_status?: string
          logo_url?: string | null
          name: string
          onboarding_status?: string
          phone?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          submitted_at?: string | null
          updated_at?: string
          vat_rate_percent?: number
        }
        Update: {
          address?: string | null
          cancellation_window_minutes?: number | null
          created_at?: string
          created_by?: string | null
          cuisine_tags?: string[]
          description?: string | null
          hours?: Json | null
          id?: string
          kosher_certificate_uploaded_at?: string | null
          kosher_certificate_url?: string | null
          kosher_status?: string
          logo_url?: string | null
          name?: string
          onboarding_status?: string
          phone?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          submitted_at?: string | null
          updated_at?: string
          vat_rate_percent?: number
        }
        Relationships: []
      }
      review_dish_ratings: {
        Row: {
          dish_id: string
          id: string
          rating: number
          review_id: string
        }
        Insert: {
          dish_id: string
          id?: string
          rating: number
          review_id: string
        }
        Update: {
          dish_id?: string
          id?: string
          rating?: number
          review_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_dish_ratings_dish_id_fkey"
            columns: ["dish_id"]
            isOneToOne: false
            referencedRelation: "dishes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_dish_ratings_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      review_helpful_votes: {
        Row: {
          created_at: string
          id: string
          is_helpful: boolean
          review_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_helpful: boolean
          review_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_helpful?: boolean
          review_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_helpful_votes_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          created_at: string
          disliked_text: string | null
          id: string
          liked_text: string | null
          nickname_display: string | null
          published_at: string | null
          restaurant_id: string
          service_rating: number
          session_id: string
          status: string
          user_id: string | null
          verification_code_hash: string
        }
        Insert: {
          created_at?: string
          disliked_text?: string | null
          id?: string
          liked_text?: string | null
          nickname_display?: string | null
          published_at?: string | null
          restaurant_id: string
          service_rating: number
          session_id: string
          status?: string
          user_id?: string | null
          verification_code_hash: string
        }
        Update: {
          created_at?: string
          disliked_text?: string | null
          id?: string
          liked_text?: string | null
          nickname_display?: string | null
          published_at?: string | null
          restaurant_id?: string
          service_rating?: number
          session_id?: string
          status?: string
          user_id?: string | null
          verification_code_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_participants: {
        Row: {
          id: string
          is_host: boolean
          joined_at: string
          left_at: string | null
          review_verification_code: string
          session_id: string
          sub_account_number: string
          user_id: string | null
        }
        Insert: {
          id?: string
          is_host?: boolean
          joined_at?: string
          left_at?: string | null
          review_verification_code: string
          session_id: string
          sub_account_number: string
          user_id?: string | null
        }
        Update: {
          id?: string
          is_host?: boolean
          joined_at?: string
          left_at?: string | null
          review_verification_code?: string
          session_id?: string
          sub_account_number?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "session_participants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          created_at: string
          first_name: string | null
          id: string
          is_active: boolean
          last_name: string | null
          phone: string | null
          restaurant_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          first_name?: string | null
          id?: string
          is_active?: boolean
          last_name?: string | null
          phone?: string | null
          restaurant_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          first_name?: string | null
          id?: string
          is_active?: boolean
          last_name?: string | null
          phone?: string | null
          restaurant_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      table_sessions: {
        Row: {
          closed_at: string | null
          id: string
          opened_at: string
          restaurant_id: string
          session_account_number: string
          status: string
          table_id: string
        }
        Insert: {
          closed_at?: string | null
          id?: string
          opened_at?: string
          restaurant_id: string
          session_account_number: string
          status?: string
          table_id: string
        }
        Update: {
          closed_at?: string | null
          id?: string
          opened_at?: string
          restaurant_id?: string
          session_account_number?: string
          status?: string
          table_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "table_sessions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "table_sessions_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      tables: {
        Row: {
          capacity: number
          created_at: string
          id: string
          is_outdoor: boolean
          qr_code_token: string
          restaurant_id: string
          smoking_allowed: boolean
          status: string
          table_number: string
          table_type: string | null
        }
        Insert: {
          capacity: number
          created_at?: string
          id?: string
          is_outdoor?: boolean
          qr_code_token: string
          restaurant_id: string
          smoking_allowed?: boolean
          status?: string
          table_number: string
          table_type?: string | null
        }
        Update: {
          capacity?: number
          created_at?: string
          id?: string
          is_outdoor?: boolean
          qr_code_token?: string
          restaurant_id?: string
          smoking_allowed?: boolean
          status?: string
          table_number?: string
          table_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tables_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          birthdate: string | null
          created_at: string
          display_name: string
          feedstars_activity_score: number
          feedstars_tier_id: number | null
          language_preference: string
          nickname: string | null
          profile_photo_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          birthdate?: string | null
          created_at?: string
          display_name: string
          feedstars_activity_score?: number
          feedstars_tier_id?: number | null
          language_preference?: string
          nickname?: string | null
          profile_photo_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          birthdate?: string | null
          created_at?: string
          display_name?: string
          feedstars_activity_score?: number
          feedstars_tier_id?: number | null
          language_preference?: string
          nickname?: string | null
          profile_photo_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_feedstars_tier_id_fkey"
            columns: ["feedstars_tier_id"]
            isOneToOne: false
            referencedRelation: "feedstars_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      waiter_calls: {
        Row: {
          acknowledged_at: string | null
          created_at: string
          id: string
          reason: string | null
          resolved_at: string | null
          session_id: string
          status: string
          table_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          resolved_at?: string | null
          session_id: string
          status?: string
          table_id: string
        }
        Update: {
          acknowledged_at?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          resolved_at?: string | null
          session_id?: string
          status?: string
          table_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "waiter_calls_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "table_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiter_calls_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bar_participant_display_names: {
        Args: { p_order_ids: string[] }
        Returns: {
          display_name: string
          order_id: string
        }[]
      }
      calculate_bill_split: {
        Args: { p_payment_id: string }
        Returns: undefined
      }
      current_manager_restaurant_ids: { Args: never; Returns: string[] }
      current_participant_ids: { Args: never; Returns: string[] }
      current_participant_session_ids: { Args: never; Returns: string[] }
      current_staff_restaurant_ids: { Args: never; Returns: string[] }
      deduct_inventory_for_order: {
        Args: { p_order_id: string }
        Returns: {
          below_threshold: boolean
          ingredient_id: string
        }[]
      }
      get_dish_critical_stock_status: {
        Args: { p_restaurant_id: string }
        Returns: {
          dish_id: string
          status: string
        }[]
      }
      get_dish_missing_ingredients: {
        Args: { p_restaurant_id: string }
        Returns: {
          dish_id: string
          ingredient_name: string
        }[]
      }
      get_dish_order_stats: {
        Args: { p_restaurant_id: string }
        Returns: {
          dish_id: string
          last_ordered_at: string
          orders_today: number
        }[]
      }
      get_reviewer_public_info: {
        Args: { p_user_ids: string[] }
        Returns: {
          age_range: string
          photo_url: string
          user_id: string
        }[]
      }
      get_unavailable_modifier_options: {
        Args: { p_restaurant_id: string }
        Returns: {
          option_id: string
        }[]
      }
      list_restaurant_staff: {
        Args: { p_restaurant_id: string }
        Returns: {
          created_at: string
          email: string
          first_name: string
          id: string
          is_active: boolean
          last_name: string
          phone: string
          role: string
        }[]
      }
      next_bar_ticket_number: {
        Args: { p_restaurant_id: string }
        Returns: number
      }
      notify_order_item_cancelled: {
        Args: { p_order_item_id: string }
        Returns: undefined
      }
      place_order_transaction: {
        Args: { p_items: Json; p_participant_id: string; p_session_id: string }
        Returns: {
          bar_ticket_number: number
          inventory_alerts: Json
          order_id: string
        }[]
      }
      receive_purchase_order: { Args: { p_po_id: string }; Returns: undefined }
      record_cancellation_inventory_decision: {
        Args: { p_order_item_id: string; p_restock: boolean }
        Returns: undefined
      }
      register_restaurant: {
        Args: {
          p_address: string
          p_hours: Json
          p_kosher_status: string
          p_name: string
          p_phone: string
          p_user_id: string
        }
        Returns: string
      }
      replace_dish_ingredients: {
        Args: { p_dish_id: string; p_rows: Json }
        Returns: undefined
      }
      restaurant_hours_excludes_saturday: {
        Args: { p_hours: Json }
        Returns: boolean
      }
      restaurant_hours_strip_saturday: {
        Args: { p_hours: Json }
        Returns: Json
      }
      restock_inventory_for_order_item: {
        Args: { p_order_item_id: string }
        Returns: undefined
      }
      update_order_item_transaction: {
        Args: {
          p_dish_size_option_id: string
          p_modifier_option_ids: Json
          p_order_item_id: string
        }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
