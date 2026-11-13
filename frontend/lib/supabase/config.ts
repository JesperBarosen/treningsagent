// The project URL and publishable key are public by design: RLS and the
// backend's JWT check are what protect the data. Set them in .env.local.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/** Pages anyone may open. Everything else needs a signed-in user (proxy.ts). */
export const PUBLIC_PATHS = ["/sign-in", "/auth/confirm"];
