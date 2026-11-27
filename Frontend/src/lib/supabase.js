import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configMissing = !url || !anon;

// Only the public anon key lives in the browser. Row Level Security keeps every
// user limited to their own rows; the Telegram session table is not readable at all.
export const supabase = createClient(url || 'https://missing.supabase.co', anon || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
