import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { TabBar, TopBar } from "@/components/nav";
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
      </head>
      <body className="min-h-dvh font-sans">
        <a
          href="#main"
          className="sr-only z-50 rounded-full bg-accent px-4 py-2 text-on-accent focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        <TopBar />
        <main id="main" className="mx-auto w-full px-4 sm:px-6">
          {children}
        </main>
        <TabBar />
      </body>
    </html>
  );
}
