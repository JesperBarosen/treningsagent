import type { MetadataRoute } from "next";

/** Web app manifest, served at /manifest.webmanifest, so the app can be added
 *  to a phone's home screen and open full screen. Colours are the light theme's
 *  tokens from DESIGN.md (a manifest takes one theme colour; the per-scheme
 *  theme-color lives in the root layout's viewport). Icons are made by
 *  scripts/make-icons.mjs. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Treningsagent",
    short_name: "Treningsagent",
    description: "Log runs and climbing sessions in plain language and see how you progress.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f4ef", // --canvas (light)
    theme_color: "#f5f4ef", // --canvas (light), matches the status bar in the layout
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // The artwork stays inside the central safe zone, so it can be cropped to any shape.
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
