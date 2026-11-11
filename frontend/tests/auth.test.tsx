import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = {
  signInWithOtp: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
};
vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({ auth }),
  accessToken: async () => (await auth.getSession()).data.session?.access_token ?? null,
}));

const { SignInForm } = await import("@/app/sign-in/sign-in-form");
const { getSessions } = await import("@/lib/api");

beforeEach(() => {
  vi.resetAllMocks();
  auth.signOut.mockResolvedValue({ error: null });
});

describe("SignInForm", () => {
  async function submit(email = "me@example.com") {
    render(<SignInForm />);
    await userEvent.type(screen.getByLabelText("Email"), email);
    await userEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
  }

  it("asks for a link without ever creating an account", async () => {
    auth.signInWithOtp.mockResolvedValue({ error: null });
    await submit();
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: "me@example.com",
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/confirm` },
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Check your email");
  });

  it("answers an uninvited address the same way", async () => {
    auth.signInWithOtp.mockResolvedValue({ error: { status: 422, message: "Signups not allowed for otp" } });
    await submit("stranger@example.com");
    expect(await screen.findByRole("status")).toHaveTextContent("Check your email");
  });

  it("says when too many emails were sent", async () => {
    auth.signInWithOtp.mockResolvedValue({ error: { status: 429, message: "rate limit" } });
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many sign-in emails");
  });

  it("explains a failed link", () => {
    render(<SignInForm linkFailed />);
    expect(screen.getByRole("alert")).toHaveTextContent("expired or was already used");
  });
});

describe("API client", () => {
  const fetchMock = vi.fn();
  const replace = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("location", { ...window.location, origin: "http://localhost:3000", replace });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sends the access token as a bearer token", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
    fetchMock.mockResolvedValue(new Response("[]", { status: 200 }));
    await getSessions(7);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.authorization).toBe("Bearer tok");
  });

  it("signs out locally and goes to /sign-in on a 401", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "stale" } } });
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(getSessions(7)).rejects.toMatchObject({ status: 401 });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(replace).toHaveBeenCalledWith("http://localhost:3000/sign-in");
  });
});
