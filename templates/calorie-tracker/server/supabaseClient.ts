import { createClient } from "@supabase/supabase-js";

let supabaseInstance: ReturnType<typeof createClient> | null = null;

export function getSupabase() {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing VITE_SUPABASE_URL in environment variables");
  }

  // For server-side, we use service key if available, otherwise fall back to anon key
  const key = supabaseServiceKey || process.env.VITE_SUPABASE_ANON_KEY;

  if (!key) {
    throw new Error("Missing Supabase credentials in environment variables");
  }

  supabaseInstance = createClient(supabaseUrl, key);
  return supabaseInstance;
}
