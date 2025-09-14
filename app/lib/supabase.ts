import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL as string;
const supabaseAnon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (_client) return _client;
  const authOptions = Platform.OS === 'web'
    ? { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
    : { storage: AsyncStorage as any, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false };
  _client = createClient(supabaseUrl, supabaseAnon, { auth: authOptions as any });
  return _client;
}

export const supabase = getSupabase();


