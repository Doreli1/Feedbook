export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
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
          ingredient_id: string
          quantity_required: number
        }
        Insert: {
          dish_id: string
          ingredient_id: string
          quantity_required: number
        }
        Update: {
          dish_id?: string
          ingredient_id?: string
          quantity_required?: number
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
            foreignKeyName: "dish_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
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
      dishes: {
        Row: {
          allergens: string[]
          category_id: string
          created_at: string
          description: string | null
          id: string
          is_available: boolean
          likes_count: number
          name: string
          photo_urls: string[]
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
          id?: string
          is_available?: boolean
          likes_count?: number
          name: string
          photo_urls?: string[]
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
          id?: string
          is_available?: boolean
          likes_count?: number
          name?: string
          photo_urls?: string[]
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
          id: number
          min_activity_score: number
          tier_name: string
        }
        Insert: {
          benefits_description: string
          id: number
          min_activity_score: number
          tier_name: string
        }
        Update: {
          benefits_description?: string
          id?: number
          min_activity_score?: number
          tier_name?: string
        }
        Relationships: []
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
          name: string
          restaurant_id: string
          sort_order: number
        }
        Insert: {
          id?: string
          name: string
          restaurant_id: string
          sort_order?: number
        }
        Update: {
          id?: string
          name?: string
          restaurant_id?: string
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
          sent_at?: string
          staff_id?: string | null
          title?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          dish_id: string
          id: string
          modifiers: Json | null
          order_id: string
          quantity: number
          status: string
          unit_price: number
        }
        Insert: {
          dish_id: string
          id?: string
          modifiers?: Json | null
          order_id: string
          quantity?: number
          status?: string
          unit_price: number
        }
        Update: {
          dish_id?: string
          id?: string
          modifiers?: Json | null
          order_id?: string
          quantity?: number
          status?: string
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
          id: string
          participant_id: string
          placed_at: string
          session_id: string
          status: string
          updated_at: string
        }
        Insert: {
          id?: string
          participant_id: string
          placed_at?: string
          session_id: string
          status?: string
          updated_at?: string
        }
        Update: {
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
          created_at: string
          created_by: string | null
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
        }
        Insert: {
          address?: string | null
          created_at?: string
          created_by?: string | null
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
        }
        Update: {
          address?: string | null
          created_at?: string
          created_by?: string | null
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
          session_id: string
          sub_account_number: string
          user_id: string | null
        }
        Insert: {
          id?: string
          is_host?: boolean
          joined_at?: string
          left_at?: string | null
          session_id: string
          sub_account_number: string
          user_id?: string | null
        }
        Update: {
          id?: string
          is_host?: boolean
          joined_at?: string
          left_at?: string | null
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
          id: string
          is_active: boolean
          restaurant_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          restaurant_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
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
          qr_code_token: string
          restaurant_id: string
          smoking_allowed: boolean
          status: string
          table_number: string
        }
        Insert: {
          capacity: number
          created_at?: string
          id?: string
          qr_code_token: string
          restaurant_id: string
          smoking_allowed?: boolean
          status?: string
          table_number: string
        }
        Update: {
          capacity?: number
          created_at?: string
          id?: string
          qr_code_token?: string
          restaurant_id?: string
          smoking_allowed?: boolean
          status?: string
          table_number?: string
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
      calculate_bill_split: {
        Args: { p_payment_id: string }
        Returns: undefined
      }
      current_manager_restaurant_ids: { Args: never; Returns: string[] }
      current_staff_restaurant_ids: { Args: never; Returns: string[] }
      deduct_inventory_for_order: {
        Args: { p_order_id: string }
        Returns: {
          below_threshold: boolean
          ingredient_id: string
        }[]
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

