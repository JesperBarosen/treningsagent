// A stand-in for Supabase Auth, so the layout check (#110) can open signed-in
// pages without a real account and without any test switch in the app. The
// session cookie holds an HS256 token; for symmetric tokens supabase-js checks
// the user with GET /auth/v1/user, which this server answers.
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";

export const AUTH_PORT = 54329;
export const AUTH_URL = `http://localhost:${AUTH_PORT}`;
const USER = {
  id: "00000000-0000-4000-8000-0000000e2e01",
  aud: "authenticated",
  role: "authenticated",
  email: "layout-check@example.test",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-11-01T00:00:00Z",
};

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

function token(): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(
    JSON.stringify({ sub: USER.id, aud: "authenticated", role: "authenticated", email: USER.email, iat: now, exp: now + 86400, session_id: "e2e" }),
  );
  const sig = createHmac("sha256", "layout-check-only").update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

/** The auth cookie @supabase/ssr reads: sb-<first label of the host>-auth-token. */
export function sessionCookie(): { name: string; value: string } {
  const access = token();
  const session = {
    access_token: access,
    refresh_token: "layout-check-refresh",
    token_type: "bearer",
    expires_in: 86400,
    expires_at: Math.floor(Date.now() / 1000) + 86400,
    user: USER,
  };
  return { name: `sb-${new URL(AUTH_URL).hostname.split(".")[0]}-auth-token`, value: `base64-${b64url(JSON.stringify(session))}` };
}

let server: Server | undefined;

export async function startMockAuth(): Promise<void> {
  server = createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "*");
    res.setHeader("content-type", "application/json");
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    if (req.url?.startsWith("/auth/v1/user")) return res.end(JSON.stringify(USER));
    res.end("{}");
  });
  await new Promise<void>((resolve) => server!.listen(AUTH_PORT, "127.0.0.1", resolve));
}

export async function stopMockAuth(): Promise<void> {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
}
