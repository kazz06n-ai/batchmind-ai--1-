import { createClient } from '@supabase/supabase-js';

// Use VITE_ vars on the client, but allow server-side process.env fallbacks.
const supabaseUrl = (typeof process !== 'undefined' && process.env && (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL))
	|| ((import.meta as any).env && (import.meta as any).env.VITE_SUPABASE_URL) || '';
const supabaseAnonKey = (typeof process !== 'undefined' && process.env && (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY))
	|| ((import.meta as any).env && (import.meta as any).env.VITE_SUPABASE_ANON_KEY) || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
