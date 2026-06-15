import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * A single browser Supabase client, or `null` when the env vars are not set.
 * When null, Lumio runs in local-only mode (history stays in the browser).
 */
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
    : null;

export const cloudEnabled = supabase !== null;

export const TABLE = "lumio_conversations";
