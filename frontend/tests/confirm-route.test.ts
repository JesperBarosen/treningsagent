import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = { exchangeCodeForSession: vi.fn(), verifyOtp: vi.fn() };
vi.mock("@/lib/supabase/server", () => ({ supabaseServer: async () => ({ auth }) }));

const { GET } = await import("@/app/auth/confirm/route");

const confirm = (query: string) =>
  GET(new NextRequest(`http://localhost:3000/auth/confirm${query}`)).then((r) => r.headers.get("location"));

beforeEach(() => vi.resetAllMocks());

describe("/auth/confirm", () => {
  it("exchanges the default PKCE code and goes home", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    expect(await confirm("?code=abc")).toBe("http://localhost:3000/");
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("still verifies a token_hash link", async () => {
    auth.verifyOtp.mockResolvedValue({ error: null });
    expect(await confirm("?token_hash=h1&type=email")).toBe("http://localhost:3000/");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "h1", type: "email" });
  });

  it("sends a failed exchange back to sign-in", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: new Error("no verifier") });
    expect(await confirm("?code=abc")).toBe("http://localhost:3000/sign-in?error=link");
  });

  it("sends Supabase's own error redirect back to sign-in", async () => {
    expect(await confirm("?error=access_denied&error_code=otp_expired")).toBe(
      "http://localhost:3000/sign-in?error=link",
    );
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
