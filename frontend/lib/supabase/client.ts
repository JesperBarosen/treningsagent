import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";

let client: SupabaseClient | undefined;

/** The browser's Supabase client. The session lives in cookies, so proxy.ts
 *  and route handlers see the same user. */
export function supabaseBrowser(): SupabaseClient {
  client ??= createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  return client;
}

/** The current access token for the backend, or null when signed out. */
export async function accessToken(): Promise<string | null> {
  const { data } = await supabaseBrowser().auth.getSession();
  return data.session?.access_token ?? null;
}
