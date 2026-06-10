import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "react-router";
import { useCallback, useState } from "react";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { useQueryClient } from "@tanstack/react-query";
import { useDbSync } from "@agent-native/core";
import {
  AppProviders,
  CommandMenu,
  DevOverlay,
  appPath,
  createAgentNativeQueryClient,
  getThemeInitScript,
  useCommandMenuShortcut,
} from "@agent-native/core/client";
import { IconSun, IconMoon } from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import type { LinksFunction } from "react-router";
import stylesheet from "./global.css?url";
import { configureTracking } from "@agent-native/core/client";

configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-clips",
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
        <link rel="manifest" href={appPath("/manifest.json")} />
        <meta name="theme-color" content="#18181B" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Clips" />
        <link rel="icon" type="image/svg+xml" href={appPath("/favicon.svg")} />
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
  useNavigationState();
  useDbSync({
    queryClient: qc,
    queryKeys: [
      "recordings",
      "transcripts",
      "comments",
      "viewers",
      "folders",
      "spaces",
      "workspace",
      "insights",
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
 * Paths that are fully public-facing and must SSR real content rather than
 * routing through the authenticated app shell. Kept in one place so both the
 * ClientOnly bypass in Root and the DbSync/CommandMenu skip in AppContent stay
 * in sync.
 */
function isStandalonePublicPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return (
    path === "/download" ||
    path.startsWith("/share/") ||
    path.startsWith("/embed/") ||
    path.startsWith("/invite/")
  );
}

function AppContent() {
  const location = useLocation();
  const standalonePublic = isStandalonePublicPath(location.pathname);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  useCommandMenuShortcut(
    useCallback(() => {
      if (!standalonePublic) setCmdkOpen(true);
    }, [standalonePublic]),
  );

  return (
    <>
      {standalonePublic ? null : <DbSyncSetup />}
      {standalonePublic ? null : (
        <CommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen}>
          <CommandMenu.Group heading="Actions">
            <CommandMenu.Item onSelect={() => {}}>Search</CommandMenu.Item>
          </CommandMenu.Group>
          <CommandMenu.Group heading="Appearance">
            <ThemeToggleItem />
          </CommandMenu.Group>
        </CommandMenu>
      )}
      {standalonePublic ? null : <DevOverlay />}
      <Outlet />
      <Toaster richColors position="bottom-left" />
    </>
  );
}

/**
 * Public share/embed/download/invite paths must SSR real content for
 * first-visit signed-out users and bots. AppProviders' isPublicPath prop
 * removes the ClientOnly gate for these paths so entry.server.tsx streams
 * actual markup and loader-fed OG meta instead of a bare spinner.
 */
export default function Root() {
  const location = useLocation();
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  return (
    <AppProviders
      queryClient={queryClient}
      isPublicPath={isStandalonePublicPath(location.pathname)}
    >
      <AppContent />
    </AppProviders>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
