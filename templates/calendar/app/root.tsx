import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "react-router";
import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { Toaster } from "sonner";
import {
  AppProviders,
  CommandMenu,
  DefaultSpinner,
  appPath,
  configureTracking,
  createAgentNativeQueryClient,
  getThemeInitScript,
  useCommandMenuShortcut,
  useDbSync,
} from "@agent-native/core/client";
import { IconSun, IconMoon } from "@tabler/icons-react";
import type { LinksFunction } from "react-router";
import stylesheet from "./global.css?url";
configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-calendar",
  }),
});

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

const THEME_INIT_SCRIPT = getThemeInitScript();

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
        />
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <link rel="icon" type="image/svg+xml" href={appPath("/favicon.svg")} />
        <link rel="manifest" href={appPath("/manifest.json")} />
        <meta name="theme-color" content="#00B5FF" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Calendar" />
        <link rel="apple-touch-icon" href={appPath("/icon-180.svg")} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

const TAB_ID = Math.random().toString(36).slice(2, 10);

function DbSyncSetup() {
  const qc = useQueryClient();
  useDbSync({
    queryClient: qc,
    queryKeys: [
      "events",
      "bookings",
      "booking-links",
      "availability",
      "settings",
      "google-status",
      "env-status",
      "integration-status",
      "integration-data",
      "zoom-status",
      "apollo-status",
      "apollo-person",
      "available-slots",
      "available-days",
      "public-settings",
      "public-availability",
      "public-booking-link",
    ],
    ignoreSource: TAB_ID,
  });
  return null;
}

function ThemeToggleItem() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return (
    <CommandMenu.Item
      onSelect={() => setTheme(isDark ? "light" : "dark")}
      keywords={["theme", "dark", "light", "mode"]}
    >
      {isDark ? <IconSun size={16} /> : <IconMoon size={16} />}
      Toggle theme
    </CommandMenu.Item>
  );
}

/**
 * Public booking routes (/book/*, /meet/*, /booking/manage/*) must SSR real
 * content for first-visit signed-out users and crawlers. These paths bypass
 * ClientOnly so entry.server.tsx can stream the actual route markup rather than
 * a bare spinner. Auth/private routes are unaffected.
 */
function isPublicBookingPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  return (
    p.startsWith("/book/") ||
    p.startsWith("/meet/") ||
    p.startsWith("/booking/manage/")
  );
}

function AppContent() {
  const [cmdkOpen, setCmdkOpen] = useState(false);
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
  return (
    <>
      <DbSyncSetup />
      <CommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen}>
        <CommandMenu.Group heading="Actions">
          <CommandMenu.Item onSelect={() => {}}>Search</CommandMenu.Item>
        </CommandMenu.Group>
        <CommandMenu.Group heading="Appearance">
          <ThemeToggleItem />
        </CommandMenu.Group>
      </CommandMenu>
      <Outlet />
    </>
  );
}

export default function Root() {
  const [queryClient] = useState(() =>
    createAgentNativeQueryClient({
      defaultOptions: {
        queries: {
          // Calendar aggressively refetches on focus because external
          // calendar events can change without a DB sync event (e.g. Google
          // Calendar webhooks with a processing delay).
          refetchOnWindowFocus: true,
          // Flat retry: calendar data fetches don't need the auth-aware
          // retry function — auth errors surface through the booking flow.
          retry: 1,
        },
      },
    }),
  );
  const location = useLocation();

  return (
    <AppProviders
      queryClient={queryClient}
      isPublicPath={isPublicBookingPath(location.pathname)}
      clientOnlyFallback={<DefaultSpinner />}
      toaster={<Toaster richColors position="bottom-center" />}
    >
      <AppContent />
    </AppProviders>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
