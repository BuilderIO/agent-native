import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "react-router";
import { useCallback, useEffect, useState } from "react";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { DeckProvider } from "@/context/DeckContext";
import { Toaster } from "@/components/ui/toaster";
import {
  AppProviders,
  CommandMenu,
  appPath,
  createAgentNativeQueryClient,
  enterStyleEditing as coreEnterStyleEditing,
  enterTextEditing as coreEnterTextEditing,
  exitSelectionMode as coreExitSelectionMode,
  useCommandMenuShortcut,
  useDbSync,
} from "@agent-native/core/client";
import { Layout as AppLayout } from "@/components/layout/Layout";
import { IconSun, IconMoon } from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { useQueryClient } from "@tanstack/react-query";
import type { LinksFunction } from "react-router";
import stylesheet from "./global.css?url";
import { configureTracking } from "@agent-native/core/client";
import changelog from "../CHANGELOG.md?raw";
import { getThemeInitScript } from "@agent-native/core/client";
import { TAB_ID } from "@/lib/tab-id";
configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-slides",
  }),
});

/** Routes that render without the app shell (sidebar + AgentSidebar) */
const BARE_ROUTES = new Set(["/slide"]);
/** Route prefixes that render without the app shell */
const BARE_PREFIXES = ["/share/", "/p/"];

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

// Key forces DeckProvider remount when code changes (HMR)
const DECK_KEY = 3;

/** Track whether we (the app) put the user into selection mode via a slide click */
let weEnteredSelectionMode = false;

/** Helper to send selection mode messages and track state */
export function enterSelectionMode(
  type: "agentNative.enterStyleEditing" | "agentNative.enterTextEditing",
  data: { selector: string },
) {
  weEnteredSelectionMode = true;
  if (type === "agentNative.enterStyleEditing") {
    coreEnterStyleEditing(data.selector);
  } else {
    coreEnterTextEditing(data.selector);
  }
}

export function exitSelectionMode() {
  weEnteredSelectionMode = false;
  coreExitSelectionMode();
}

function useExitSelectionOnOutsideClick() {
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (!weEnteredSelectionMode) return;
      const target = e.target as HTMLElement;
      if (
        target.closest(".slide-content") ||
        target.closest(".slide-image-clickable")
      ) {
        return;
      }
      exitSelectionMode();
    };
    window.addEventListener("pointerdown", handler, { capture: true });
    return () =>
      window.removeEventListener("pointerdown", handler, { capture: true });
  }, []);
}

const THEME_INIT_SCRIPT = getThemeInitScript("dark", true);

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
        <meta name="theme-color" content="#EC4899" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Slides" />
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

function AppContent() {
  useExitSelectionOnOutsideClick();
  useNavigationState();
  const qc = useQueryClient();
  useDbSync({
    queryClient: qc,
    queryKeys: [
      "action",
      "app-state",
      "navigate-command",
      "show-questions",
      "env-status",
    ],
    ignoreSource: TAB_ID,
  });
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [cmdkOpen, setCmdkOpen] = useState(false);
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
  const location = useLocation();

  const isBare =
    BARE_ROUTES.has(location.pathname) ||
    BARE_PREFIXES.some((p) => location.pathname.startsWith(p)) ||
    location.pathname.endsWith("/present");

  if (isBare) {
    return (
      <DeckProvider key={DECK_KEY}>
        <Outlet />
      </DeckProvider>
    );
  }

  return (
    <>
      <CommandMenu
        open={cmdkOpen}
        onOpenChange={setCmdkOpen}
        changelog={changelog}
        changelogKey="slides"
      >
        <CommandMenu.Group heading="Presentations">
          <CommandMenu.Item onSelect={() => {}}>Search decks</CommandMenu.Item>
        </CommandMenu.Group>
        <CommandMenu.Group heading="Appearance">
          <CommandMenu.Item
            onSelect={() => setTheme(isDark ? "light" : "dark")}
            keywords={["theme", "dark", "light", "mode"]}
          >
            {isDark ? <IconSun size={16} /> : <IconMoon size={16} />}
            Toggle {isDark ? "light" : "dark"} mode
          </CommandMenu.Item>
        </CommandMenu.Group>
      </CommandMenu>
      <DeckProvider key={DECK_KEY}>
        <AppLayout>
          <Outlet />
        </AppLayout>
      </DeckProvider>
    </>
  );
}

export default function Root() {
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  const location = useLocation();

  if (BARE_PREFIXES.some((p) => location.pathname.startsWith(p))) {
    return <Outlet />;
  }

  return (
    <AppProviders queryClient={queryClient} defaultTheme="dark">
      <AppContent />
      {/* useToast-based Toaster — separate from AppProviders' sonner Toaster.
          Components throughout the app call toast() from @/hooks/use-toast,
          which requires this Toaster to be mounted. */}
      <Toaster />
    </AppProviders>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
