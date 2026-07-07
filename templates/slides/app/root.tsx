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
  useT,
} from "@agent-native/core/client";
import { configureTracking } from "@agent-native/core/client";
import {
  getLocaleInitScript,
  getThemeInitScript,
} from "@agent-native/core/client";
import { IconSun, IconMoon } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useState } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "react-router";
import type { LinksFunction } from "react-router";

import { Layout as AppLayout } from "@/components/layout/Layout";
import { Toaster } from "@/components/ui/toaster";
import { AppToolkitProvider } from "@/components/ui/toolkit-provider";
import { DeckProvider } from "@/context/DeckContext";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { TAB_ID } from "@/lib/tab-id";

import changelog from "../CHANGELOG.md?raw";
import { i18nCatalog } from "./i18n";

import stylesheet from "./global.css?url";
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

const THEME_INIT_SCRIPT_SELECTOR = "script[data-agent-native-theme-init]";
const LOCALE_INIT_SCRIPT_SELECTOR = "script[data-agent-native-locale-init]";

function getHydrationStableThemeInitScript() {
  if (typeof document !== "undefined") {
    const existing = document.querySelector<HTMLScriptElement>(
      THEME_INIT_SCRIPT_SELECTOR,
    );
    if (existing?.innerHTML) return existing.innerHTML;
  }
  return getThemeInitScript("dark", true);
}

function getHydrationStableLocaleInitScript() {
  if (typeof document !== "undefined") {
    const existing = document.querySelector<HTMLScriptElement>(
      LOCALE_INIT_SCRIPT_SELECTOR,
    );
    if (existing?.innerHTML) return existing.innerHTML;
  }
  return getLocaleInitScript();
}

const THEME_INIT_SCRIPT = getHydrationStableThemeInitScript();
const LOCALE_INIT_SCRIPT = getHydrationStableLocaleInitScript();

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-US" dir="ltr" data-locale="en-US" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
        />
        <script
          data-agent-native-theme-init
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <script
          data-agent-native-locale-init
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: LOCALE_INIT_SCRIPT }}
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
  const t = useT();
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
        <CommandMenu.Group heading={t("root.commandPresentations")}>
          <CommandMenu.Item onSelect={() => {}}>
            {t("root.searchDecks")}
          </CommandMenu.Item>
        </CommandMenu.Group>
        <CommandMenu.Group heading={t("root.commandAppearance")}>
          <CommandMenu.Item
            onSelect={() => setTheme(isDark ? "light" : "dark")}
            keywords={["theme", "dark", "light", "mode"]}
          >
            {isDark ? <IconSun size={16} /> : <IconMoon size={16} />}
            {t("root.toggleTheme")}
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
    <AppToolkitProvider>
      <AppProviders
        queryClient={queryClient}
        defaultTheme="dark"
        i18n={{ catalog: i18nCatalog }}
      >
        <AppContent />
        {/* useToast-based Toaster - separate from AppProviders' sonner Toaster.
          Components throughout the app call toast() from @agent-native/toolkit,
          which requires this Toaster to be mounted. */}
        <Toaster />
      </AppProviders>
    </AppToolkitProvider>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
