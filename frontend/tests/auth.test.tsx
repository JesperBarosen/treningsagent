import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = {
  signInWithOtp: vi.fn(),
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  signUp: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(),
};
vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({ auth }),
  accessToken: async () => (await auth.getSession()).data.session?.access_token ?? null,
}));

const { SignInForm } = await import("@/app/sign-in/sign-in-form");
const { SetPasswordForm } = await import("@/app/account/set-password-form");
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
    expect(screen.getByRole("alert")).toHaveTextContent("didn't work");
  });
});

describe("SignInForm with a password", () => {
  const replace = vi.fn();
  beforeEach(() => vi.stubGlobal("location", { ...window.location, origin: "http://localhost:3000", replace }));
  afterEach(() => vi.unstubAllGlobals());

  async function submit(password = "correct horse") {
    render(<SignInForm />);
    await userEvent.click(screen.getByRole("radio", { name: "Password" }));
    await userEvent.type(screen.getByLabelText("Email"), "me@example.com");
    await userEvent.type(screen.getByLabelText("Password"), password);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  }

  it("signs in an existing user and opens the app, never signing up", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
    await submit();
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "me@example.com", password: "correct horse" });
    expect(replace).toHaveBeenCalledWith("http://localhost:3000/");
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("gives one answer for a wrong password or an unknown address", async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: {},
      error: { status: 400, code: "invalid_credentials", message: "Invalid login credentials" },
    });
    await submit("wrong");
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong email or password");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect(replace).not.toHaveBeenCalled();
  });

  it("says when there were too many attempts", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: { status: 429, message: "rate limit" } });
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts");
  });
});

describe("SetPasswordForm", () => {
  const button = () => screen.getByRole("button", { name: "Set password" });
  async function fill(password: string, confirm = password) {
    render(<SetPasswordForm />);
    await userEvent.type(screen.getByLabelText("New password"), password);
    await userEvent.type(screen.getByLabelText("Repeat password"), confirm);
  }

  it("needs at least 8 characters, typed twice the same", async () => {
    await fill("short");
    expect(button()).toBeDisabled();
    expect(screen.getByText("At least 8 characters.")).toBeInTheDocument();
  });

  it("won't save when the two passwords differ", async () => {
    await fill("long enough", "long enougj");
    expect(button()).toBeDisabled();
    expect(screen.getByText("The passwords don't match.")).toBeInTheDocument();
  });

  it("sets the password for the signed-in user", async () => {
    auth.updateUser.mockResolvedValue({ data: {}, error: null });
    await fill("long enough");
    await userEvent.click(button());
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "long enough" });
    expect(await screen.findByRole("status")).toHaveTextContent("Password saved");
  });

  it("explains an error from Supabase", async () => {
    auth.updateUser.mockResolvedValue({ data: {}, error: { status: 422, code: "same_password", message: "" } });
    await fill("long enough");
    await userEvent.click(button());
    expect(await screen.findByRole("alert")).toHaveTextContent("already your password");
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
