import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@feedbook/types';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY — check apps/mobile/.env.local');
}

// NOTE (2026-09-07): .env.local currently points at the cloud project
// (xekiayczikqeypwupvbi.supabase.co), not the local Docker stack — every new
// migration/Edge Function from this session (Stage 2 unit_cost, Stage 3
// tables/sessions functions, anonymous sign-in) exists LOCALLY ONLY so far.
// Sign-in against the real device will fail against those features until the
// cloud project is synced, or this is pointed at the PC's LAN IP for the
// local stack during dev. Flagged, not fixed here — a real decision for
// whoever runs the app next.

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
