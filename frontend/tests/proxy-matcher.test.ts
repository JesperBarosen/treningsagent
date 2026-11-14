// @vitest-environment node
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import { config } from "@/proxy";

/** Uses Next's own matcher compiler, so this checks what actually runs in production. */
const runsOn = (path: string) =>
  unstable_doesMiddlewareMatch({ config, url: `http://localhost:3000${path}` });

describe("proxy matcher", () => {
  // Pages: the proxy sends signed-out visitors to /sign-in (and signed-in ones
  // away from it), so it has to run on every one of them.
  it.each(["/", "/log", "/sessions", "/dashboard", "/sign-in", "/auth/confirm"])(
    "runs on the page %s",
    (path) => {
      expect(runsOn(path)).toBe(true);
    },
  );

  it.each([
    "/favicon.ico",
    "/manifest.webmanifest",
    "/icon-192.png",
    "/apple-icon.png",
    "/_next/static/chunks/main.js",
    "/_next/image",
  ])("skips the file %s", (path) => {
    expect(runsOn(path)).toBe(false);
  });
});
