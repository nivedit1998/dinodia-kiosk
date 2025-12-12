// src/api/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';
import { ENV } from '../config/env';

// Types for Supabase can be generated via `supabase gen types typescript`.
// Here, we use `any` for brevity; you can plug in your own Database types.
type Database = any;

export const supabase = createClient<Database>(
  ENV.SUPABASE_URL,
  ENV.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
    },
  }
);
