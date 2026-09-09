import { createClient } from '@supabase/supabase-js';

// Estas dos variables se configuran en Vercel (Settings -> Environment Variables)
// y en local en un archivo .env.local (ver .env.local.example).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
