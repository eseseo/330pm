import { createClient } from "@supabase/supabase-js";
import { getPublicEnv, getServerEnv, getServiceEnv } from "@/lib/env";

export function publicSupabase() {
  const env = getPublicEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function serviceSupabase() {
  const env = getServiceEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function writeSupabase() {
  const env = getServerEnv();
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return {
    client: createClient(env.NEXT_PUBLIC_SUPABASE_URL, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    usingServiceRole: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
  };
}
