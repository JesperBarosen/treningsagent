import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { PUBLIC_PATHS, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase/config";

/** Refreshes the Supabase session cookie on every page request and sends
 *  signed-out visitors to /sign-in. The backend checks the token again on
 *  every API call, so this is only the first gate. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet, headers) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // getClaims verifies the token's signature (against the project's JWKS), unlike getSession.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  const redirect = (to: URL) => {
    const res = NextResponse.redirect(to);
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };
  if (!signedIn && !isPublic) {
    return redirect(new URL("/sign-in", request.url));
  }
  if (signedIn && pathname === "/sign-in") {
    return redirect(new URL("/", request.url));
  }
  return response;
}

export const config = {
  // Every page, but not Next's own assets or files with an extension (favicon, images).
  matcher: ["/((?!_next/static|_next/image|.*\.[a-zA-Z0-9]+$).*)"],
};
