import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: window.sessionStorage,
  },
})

// Recovery must never restore/replace a dashboard session or consume URL tokens.
export function createRecoveryClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storageKey: `boardmate-recovery-${globalThis.crypto.randomUUID()}`,
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
