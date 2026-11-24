import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL || "https://wjdtqgfrqyrwctmrbzhr.supabase.co";
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_CPoH5N5Tmw6Fu2PMXBpCPQ_QxGvrHnR";

export const supabaseConfigured =
  Boolean(supabaseUrl) &&
  Boolean(supabaseAnonKey);

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey || "missing-supabase-anon-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);
