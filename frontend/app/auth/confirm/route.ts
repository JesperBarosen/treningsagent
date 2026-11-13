import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/** Where the magic link lands (the emailRedirectTo the sign-in form sends).
 *
 *  - `?code=` (the default {{ .ConfirmationURL }} email, PKCE): Supabase has
 *    verified the link and redirected here; the code is exchanged for a
 *    session using the verifier cookie, so it only works in the browser that
 *    asked for the link.
 *  - `?token_hash=&type=` (an edited template, which needs custom SMTP):
 *    verified here, in any browser.
 *
 *  Anything else, including Supabase's own `?error=` redirect for an expired
 *  link, goes back to /sign-in?error=link. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;

  let ok = false;
  if (code || (tokenHash && type)) {
    const supabase = await supabaseServer();
    const { error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: type! });
    ok = !error;
  }
  return NextResponse.redirect(new URL(ok ? "/" : "/sign-in?error=link", request.url));
}
