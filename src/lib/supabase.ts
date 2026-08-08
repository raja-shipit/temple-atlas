import { createClient } from "@supabase/supabase-js";

// Server-side client — uses the service role key, so this file must never be
// imported from client components. All Anthropic/YouTube/geocoding calls and
// admin writes go through this.
export function getServiceSupabase() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars."
    );
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}

// Public/browser client — anon key only, safe to use in client components
// for read-only queries against published temples.
export function getPublicSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY env vars."
    );
  }

  return createClient(url, anonKey, {
    auth: { persistSession: false },
  });
}
