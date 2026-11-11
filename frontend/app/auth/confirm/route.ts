import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/** Where the magic link lands. Accepts the token_hash link from the edited
 *  email template (works in any browser) and the default PKCE `code` link
 *  (only in the browser that asked for it). */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const code = params.get("code");
  const supabase = await supabaseServer();

  const { error } = tokenHash && type
    ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    : code
      ? await supabase.auth.exchangeCodeForSession(code)
      : { error: new Error("missing token") };

  const url = new URL(error ? "/sign-in" : "/", request.url);
  if (error) url.searchParams.set("error", "link");
  return NextResponse.redirect(url);
}

