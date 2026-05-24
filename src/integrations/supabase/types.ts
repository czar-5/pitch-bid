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
      auction_players: {
        Row: {
          auction_id: string
          auction_order: number | null
          created_at: string
          icon_team_id: string | null
          id: string
          is_icon: boolean
          paused_remaining_seconds: number | null
          player_id: string
          round_ends_at: string | null
          sold_price: number | null
          sold_team_id: string | null
          status: Database["public"]["Enums"]["auction_player_status"]
        }
        Insert: {
          auction_id: string
          auction_order?: number | null
          created_at?: string
          icon_team_id?: string | null
          id?: string
          is_icon?: boolean
          paused_remaining_seconds?: number | null
          player_id: string
          round_ends_at?: string | null
          sold_price?: number | null
          sold_team_id?: string | null
          status?: Database["public"]["Enums"]["auction_player_status"]
        }
        Update: {
          auction_id?: string
          auction_order?: number | null
          created_at?: string
          icon_team_id?: string | null
          id?: string
          is_icon?: boolean
          paused_remaining_seconds?: number | null
          player_id?: string
          round_ends_at?: string | null
          sold_price?: number | null
          sold_team_id?: string | null
          status?: Database["public"]["Enums"]["auction_player_status"]
        }
        Relationships: [
          {
            foreignKeyName: "auction_players_auction_id_fkey"
            columns: ["auction_id"]
            isOneToOne: false
            referencedRelation: "auctions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auction_players_icon_team_id_fkey"
            columns: ["icon_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auction_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auction_players_sold_team_id_fkey"
            columns: ["sold_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      auction_teams: {
        Row: {
          auction_id: string
          budget_remaining: number
          created_at: string
          id: string
          is_ready: boolean
          players_bought: number
          team_id: string
        }
        Insert: {
          auction_id: string
          budget_remaining?: number
          created_at?: string
          id?: string
          is_ready?: boolean
          players_bought?: number
          team_id: string
        }
        Update: {
          auction_id?: string
          budget_remaining?: number
          created_at?: string
          id?: string
          is_ready?: boolean
          players_bought?: number
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auction_teams_auction_id_fkey"
            columns: ["auction_id"]
            isOneToOne: false
            referencedRelation: "auctions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auction_teams_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      auctions: {
        Row: {
          baseline_price: number
          bid_rules_json: Json
          created_at: string
          created_by: string | null
          current_player_id: string | null
          id: string
          last_finalized_player_id: string | null
          max_players_per_team: number
          min_players_per_team: number
          name: string
          round_closure_seconds: number
          scheduled_at: string
          status: Database["public"]["Enums"]["auction_status"]
          team_budget: number
          updated_at: string
        }
        Insert: {
          baseline_price?: number
          bid_rules_json?: Json
          created_at?: string
          created_by?: string | null
          current_player_id?: string | null
          id?: string
          last_finalized_player_id?: string | null
          max_players_per_team?: number
          min_players_per_team?: number
          name: string
          round_closure_seconds?: number
          scheduled_at?: string
          status?: Database["public"]["Enums"]["auction_status"]
          team_budget?: number
          updated_at?: string
        }
        Update: {
          baseline_price?: number
          bid_rules_json?: Json
          created_at?: string
          created_by?: string | null
          current_player_id?: string | null
          id?: string
          last_finalized_player_id?: string | null
          max_players_per_team?: number
          min_players_per_team?: number
          name?: string
          round_closure_seconds?: number
          scheduled_at?: string
          status?: Database["public"]["Enums"]["auction_status"]
          team_budget?: number
          updated_at?: string
        }
        Relationships: []
      }
      bids: {
        Row: {
          amount: number
          auction_player_id: string
          bidder_user_id: string
          created_at: string
          id: string
          team_id: string
        }
        Insert: {
          amount: number
          auction_player_id: string
          bidder_user_id: string
          created_at?: string
          id?: string
          team_id: string
        }
        Update: {
          amount?: number
          auction_player_id?: string
          bidder_user_id?: string
          created_at?: string
          id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bids_auction_player_id_fkey"
            columns: ["auction_player_id"]
            isOneToOne: false
            referencedRelation: "auction_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bids_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          batting_avg: number
          batting_sr: number
          batting_style: string | null
          bowling_style: string | null
          created_at: string
          cric_heroes_link: string | null
          id: string
          matches: number
          name: string
          photo: string | null
          role: Database["public"]["Enums"]["player_role"]
          runs: number
          wickets: number
        }
        Insert: {
          batting_avg?: number
          batting_sr?: number
          batting_style?: string | null
          bowling_style?: string | null
          created_at?: string
          cric_heroes_link?: string | null
          id?: string
          matches?: number
          name: string
          photo?: string | null
          role?: Database["public"]["Enums"]["player_role"]
          runs?: number
          wickets?: number
        }
        Update: {
          batting_avg?: number
          batting_sr?: number
          batting_style?: string | null
          bowling_style?: string | null
          created_at?: string
          cric_heroes_link?: string | null
          id?: string
          matches?: number
          name?: string
          photo?: string | null
          role?: Database["public"]["Enums"]["player_role"]
          runs?: number
          wickets?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id: string
          name?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      team_members: {
        Row: {
          created_at: string
          id: string
          membership_role: Database["public"]["Enums"]["membership_role"]
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          membership_role: Database["public"]["Enums"]["membership_role"]
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          membership_role?: Database["public"]["Enums"]["membership_role"]
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          id: string
          logo_url: string | null
          name: string
          primary_color: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          primary_color?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          primary_color?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      end_auction: { Args: { _auction_id: string }; Returns: undefined }
      finalize_current: { Args: { _auction_id: string }; Returns: undefined }
      get_next_player: {
        Args: { _auction_id: string }
        Returns: {
          batting_avg: number
          batting_sr: number
          batting_style: string
          bowling_style: string
          matches: number
          name: string
          photo: string
          player_id: string
          role: string
          runs: number
          wickets: number
        }[]
      }
      go_live_auction: { Args: { _auction_id: string }; Returns: undefined }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      next_player: { Args: { _auction_id: string }; Returns: string }
      pause_round: { Args: { _auction_id: string }; Returns: undefined }
      place_bid: {
        Args: { _auction_player_id: string; _team_id: string }
        Returns: number
      }
      reset_round: { Args: { _auction_id: string }; Returns: undefined }
      resume_round: { Args: { _auction_id: string }; Returns: undefined }
      sell_current: { Args: { _auction_id: string }; Returns: undefined }
      skip_current: { Args: { _auction_id: string }; Returns: undefined }
      start_auction: { Args: { _auction_id: string }; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "manager" | "co_manager" | "viewer"
      auction_player_status: "queued" | "live" | "sold" | "unsold" | "skipped"
      auction_status:
        | "upcoming"
        | "lobby"
        | "live"
        | "paused"
        | "completed"
        | "archived"
      membership_role: "manager" | "co_manager"
      player_role:
        | "batter"
        | "bowler"
        | "batting_allrounder"
        | "bowling_allrounder"
        | "wicket_keeper"
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
  public: {
    Enums: {
      app_role: ["admin", "manager", "co_manager", "viewer"],
      auction_player_status: ["queued", "live", "sold", "unsold", "skipped"],
      auction_status: [
        "upcoming",
        "lobby",
        "live",
        "paused",
        "completed",
        "archived",
      ],
      membership_role: ["manager", "co_manager"],
      player_role: [
        "batter",
        "bowler",
        "batting_allrounder",
        "bowling_allrounder",
        "wicket_keeper",
      ],
    },
  },
} as const
