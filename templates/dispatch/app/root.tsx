import {
  AppProviders,
  CommandMenu,
  configureTracking,
  createAgentNativeQueryClient,
  getLocaleInitScript,
  getThemeInitScript,
  useCommandMenuShortcut,
  useDbSync,
  appPath,
  useT,
} from "@agent-native/core/client";
import { Layout as AppLayout } from "@agent-native/dispatch/components";
import { IconSun, IconMoon } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useNavigate,
} from "react-router";
import type { LinksFunction } from "react-router";
import { Toaster } from "sonner";

import { useNavigationState } from "@/hooks/use-navigation-state";

import changelog from "../CHANGELOG.md?raw";
import { dispatchExtensions } from "./dispatch-extensions";
import { i18nCatalog } from "./i18n";

import stylesheet from "./global.css?url";

configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-dispatch",
  }),
});

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

const THEME_INIT_SCRIPT = getThemeInitScript();
const LOCALE_INIT_SCRIPT = getLocaleInitScript();

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
        <script
          data-agent-native-locale-init
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: LOCALE_INIT_SCRIPT }}
        />
        <link rel="manifest" href={appPath("/manifest.json")} />
        <meta name="theme-color" content="#0f172a" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Dispatch" />
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
  useNavigationState(dispatchExtensions);
  useDbSync({
    queryClient: qc,
    queryKeys: [
      "list-dispatch-overview",
      "list-destinations",
      "list-linked-identities",
      "list-dispatch-approvals",
      "list-dispatch-audit",
      "list-dispatch-usage-metrics",
      "list-agent-thread-sources",
      "search-agent-threads",
      "get-agent-thread-debug",
      "list-mcp-app-access",
      "get-dispatch-settings",
      "list-connected-agents",
      "list-vault-secrets",
      "list-vault-grants",
      "list-vault-requests",
      "list-vault-audit",
      "list-workspace-resources",
      "list-workspace-resource-grants",
      "list-workspace-apps",
      "list-integrations-catalog",
      "list-workspace-connections",
      ...(dispatchExtensions.queryKeys ?? []),
    ],
    ignoreSource: TAB_ID,
  });
  useThreadDeepLink();
  return null;
}

/**
 * Reads ?thread=<id> from the URL on mount and opens that thread in the
 * full-page chat route.
 */
function useThreadDeepLink() {
  const navigate = useNavigate();
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current) return;
    const params = new URLSearchParams(window.location.search);
    const threadId = params.get("thread");
    if (!threadId) return;
    handled.current = true;

    params.delete("thread");
    navigate(
      {
        pathname: "/chat",
        search: params.toString() ? `?${params.toString()}` : "",
        hash: window.location.hash,
      },
      {
        replace: true,
        state: {
          dispatchThread: {
            id: `${Date.now()}-${threadId}`,
            threadId,
          },
        },
      },
    );
  }, [navigate]);
}

function ThemeToggleItem() {
  const { resolvedTheme, setTheme } = useTheme();
  const t = useT();
  const isDark = resolvedTheme === "dark";
  return (
    <CommandMenu.Item
      onSelect={() => setTheme(isDark ? "light" : "dark")}
      keywords={["theme", "dark", "light", "mode"]}
    >
      {isDark ? <IconSun size={16} /> : <IconMoon size={16} />}
      {t("root.toggleTheme")}
    </CommandMenu.Item>
  );
}

function AppContent() {
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const t = useT();
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
  return (
    <>
      <DbSyncSetup />
      <CommandMenu
        open={cmdkOpen}
        onOpenChange={setCmdkOpen}
        changelog={changelog}
        changelogKey="dispatch"
      >
        <CommandMenu.Group heading={t("root.commandActions")}>
          <CommandMenu.Item onSelect={() => {}}>
            {t("root.commandSearch")}
          </CommandMenu.Item>
        </CommandMenu.Group>
        <CommandMenu.Group heading={t("root.commandAppearance")}>
          <ThemeToggleItem />
        </CommandMenu.Group>
      </CommandMenu>
      <AppLayout extensions={dispatchExtensions}>
        <Outlet />
      </AppLayout>
    </>
  );
}

export default function Root() {
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  return (
    <AppProviders
      queryClient={queryClient}
      toaster={<Toaster richColors position="bottom-left" closeButton />}
      i18n={{ catalog: i18nCatalog }}
    >
      <AppContent />
    </AppProviders>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
