export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      barbers: {
        Row: {
          created_at: string
          display_name: string
          id: string
          role: Database["public"]["Enums"]["barber_role"]
          shop_id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id: string
          role?: Database["public"]["Enums"]["barber_role"]
          shop_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          role?: Database["public"]["Enums"]["barber_role"]
          shop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "barbers_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          created_at: string
          id: string
          name: string
          phone: string | null
          shop_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          phone?: string | null
          shop_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          phone?: string | null
          shop_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
      photos: {
        Row: {
          created_at: string
          height: number
          id: string
          slot: Database["public"]["Enums"]["photo_slot"]
          storage_path: string
          updated_at: string
          upload_status: Database["public"]["Enums"]["upload_status"]
          visit_id: string
          width: number
        }
        Insert: {
          created_at?: string
          height: number
          id?: string
          slot: Database["public"]["Enums"]["photo_slot"]
          storage_path: string
          updated_at?: string
          upload_status?: Database["public"]["Enums"]["upload_status"]
          visit_id: string
          width: number
        }
        Update: {
          created_at?: string
          height?: number
          id?: string
          slot?: Database["public"]["Enums"]["photo_slot"]
          storage_path?: string
          updated_at?: string
          upload_status?: Database["public"]["Enums"]["upload_status"]
          visit_id?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "photos_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visits"
            referencedColumns: ["id"]
          },
        ]
      }
      shops: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      styles: {
        Row: {
          active: boolean
          created_at: string
          dimension: Database["public"]["Enums"]["style_dimension"]
          id: string
          name: string
          prompt: string | null
          reference_image_path: string | null
          slug: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          dimension: Database["public"]["Enums"]["style_dimension"]
          id?: string
          name: string
          prompt?: string | null
          reference_image_path?: string | null
          slug: string
          sort_order: number
        }
        Update: {
          active?: boolean
          created_at?: string
          dimension?: Database["public"]["Enums"]["style_dimension"]
          id?: string
          name?: string
          prompt?: string | null
          reference_image_path?: string | null
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      visits: {
        Row: {
          after_photo_path: string | null
          barber_id: string
          chosen_beard_style_id: string | null
          chosen_hair_style_id: string | null
          chosen_preview_id: string | null
          client_id: string
          closed_at: string | null
          consent_at: string | null
          consent_given: boolean
          created_at: string
          id: string
          provider_name: string | null
          share_expires_at: string | null
          share_token: string | null
          shop_id: string
          status: Database["public"]["Enums"]["visit_status"]
        }
        Insert: {
          after_photo_path?: string | null
          barber_id: string
          chosen_beard_style_id?: string | null
          chosen_hair_style_id?: string | null
          chosen_preview_id?: string | null
          client_id: string
          closed_at?: string | null
          consent_at?: string | null
          consent_given?: boolean
          created_at?: string
          id?: string
          provider_name?: string | null
          share_expires_at?: string | null
          share_token?: string | null
          shop_id: string
          status?: Database["public"]["Enums"]["visit_status"]
        }
        Update: {
          after_photo_path?: string | null
          barber_id?: string
          chosen_beard_style_id?: string | null
          chosen_hair_style_id?: string | null
          chosen_preview_id?: string | null
          client_id?: string
          closed_at?: string | null
          consent_at?: string | null
          consent_given?: boolean
          created_at?: string
          id?: string
          provider_name?: string | null
          share_expires_at?: string | null
          share_token?: string | null
          shop_id?: string
          status?: Database["public"]["Enums"]["visit_status"]
        }
        Relationships: [
          {
            foreignKeyName: "visits_barber_id_shop_id_fkey"
            columns: ["barber_id", "shop_id"]
            isOneToOne: false
            referencedRelation: "barbers"
            referencedColumns: ["id", "shop_id"]
          },
          {
            foreignKeyName: "visits_chosen_beard_style_id_fkey"
            columns: ["chosen_beard_style_id"]
            isOneToOne: false
            referencedRelation: "dashboard_top_beard_styles"
            referencedColumns: ["style_id"]
          },
          {
            foreignKeyName: "visits_chosen_beard_style_id_fkey"
            columns: ["chosen_beard_style_id"]
            isOneToOne: false
            referencedRelation: "dashboard_top_hair_styles"
            referencedColumns: ["style_id"]
          },
          {
            foreignKeyName: "visits_chosen_beard_style_id_fkey"
            columns: ["chosen_beard_style_id"]
            isOneToOne: false
            referencedRelation: "styles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_chosen_hair_style_id_fkey"
            columns: ["chosen_hair_style_id"]
            isOneToOne: false
            referencedRelation: "dashboard_top_beard_styles"
            referencedColumns: ["style_id"]
          },
          {
            foreignKeyName: "visits_chosen_hair_style_id_fkey"
            columns: ["chosen_hair_style_id"]
            isOneToOne: false
            referencedRelation: "dashboard_top_hair_styles"
            referencedColumns: ["style_id"]
          },
          {
            foreignKeyName: "visits_chosen_hair_style_id_fkey"
            columns: ["chosen_hair_style_id"]
            isOneToOne: false
            referencedRelation: "styles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visits_client_id_shop_id_fkey"
            columns: ["client_id", "shop_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id", "shop_id"]
          },
          {
            foreignKeyName: "visits_shop_id_fkey"
            columns: ["shop_id"]
            isOneToOne: false
            referencedRelation: "shops"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      dashboard_returning_clients: {
        Row: {
          returning_clients: number | null
          returning_share: number | null
          total_clients: number | null
        }
        Relationships: []
      }
      dashboard_top_beard_styles: {
        Row: {
          name: string | null
          slug: string | null
          style_id: string | null
          visits: number | null
        }
        Relationships: []
      }
      dashboard_top_hair_styles: {
        Row: {
          name: string | null
          slug: string | null
          style_id: string | null
          visits: number | null
        }
        Relationships: []
      }
      dashboard_total_clients: {
        Row: {
          total_clients: number | null
        }
        Relationships: []
      }
      dashboard_visit_counts: {
        Row: {
          visits_this_month: number | null
          visits_this_week: number | null
        }
        Relationships: []
      }
      dashboard_visits_per_barber: {
        Row: {
          barber_id: string | null
          display_name: string | null
          visits: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      current_shop_id: { Args: never; Returns: string }
      is_owner: { Args: never; Returns: boolean }
      local_period_start: { Args: { unit: string }; Returns: string }
      new_share_token: { Args: never; Returns: string }
    }
    Enums: {
      barber_role: "owner" | "barber"
      photo_slot: "front" | "left" | "right" | "back"
      style_dimension: "hair" | "beard"
      upload_status: "uploading" | "uploaded"
      visit_status: "open" | "closed"
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
    Enums: {
      barber_role: ["owner", "barber"],
      photo_slot: ["front", "left", "right", "back"],
      style_dimension: ["hair", "beard"],
      upload_status: ["uploading", "uploaded"],
      visit_status: ["open", "closed"],
    },
  },
} as const

