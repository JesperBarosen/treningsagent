import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { TabBar, TopBar } from "@/components/nav";
import { CHART_PREFS_SCRIPT } from "@/lib/chart-prefs";
import { DISCREET_SCRIPT } from "@/lib/discreet";
import { THEME_COLORS, THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: { default: "treningsagent", template: "%s · treningsagent" },
  description: "Log runs and climbing sessions in plain language and see how you progress.",
  applicationName: "Treningsagent",
  // Home-screen app on iPhone: full screen, named "Treningsagent", status bar
  // in the page colour. The icon is app/apple-icon.png; the manifest is app/manifest.ts.
  appleWebApp: { capable: true, title: "Treningsagent", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the page reach the screen edges in standalone mode; the tab bar and
  // sheets already pad for env(safe-area-inset-bottom).
  viewportFit: "cover",
  // Follows the OS (System). An explicit Light/Dark choice rewrites these
  // metas in the browser (lib/theme.ts applyTheme and THEME_SCRIPT).
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: THEME_SCRIPT may set data-theme before React hydrates.
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable} antialiased`} suppressHydrationWarning>
      <head>
        {/* Applies a saved Light/Dark choice before the first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {/* Discreet mode, also before the first paint, so numbers never flash readable. */}
        <script dangerouslySetInnerHTML={{ __html: DISCREET_SCRIPT }} />
        {/* The chosen chart palette (#61), also before the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: CHART_PREFS_SCRIPT }} />
      </head>
      {/* Below md the page is an app shell: the body is exactly the
          screen tall and never scrolls; <main> is the scroll area. A scrolling
          document on iOS (home-screen app, iOS 26+) can leave the layout
          viewport out of step with the screen, which drags the fixed tab bar
          up into the middle of the page and the sticky top bar off it. */}
      <body className="min-h-dvh font-sans max-md:flex max-md:h-dvh max-md:flex-col max-md:overflow-hidden">
        <a
          href="#main"
          className="sr-only z-50 rounded-full bg-accent px-4 py-2 text-on-accent focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        <TopBar />
        {/* Below md the fixed tab bar covers the bottom of the screen; pb-tab-bar
            keeps every page's last row clear of it (and of the home indicator).
            There <main> is also the one scroll area (see <body>). */}
        <main
          id="main"
          className="mx-auto w-full px-4 pb-tab-bar sm:px-6 max-md:min-h-0 max-md:flex-1 max-md:overflow-y-auto max-md:overscroll-contain md:pb-0"
        >
          {children}
        </main>
        <TabBar />
      </body>
    </html>
  );
}
