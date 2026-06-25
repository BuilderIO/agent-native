import { useDbSync } from "@agent-native/core/client";
import {
  AppProviders,
  CommandMenu,
  appPath,
  createAgentNativeQueryClient,
  getLocaleInitScript,
  getThemeInitScript,
  useCommandMenuShortcut,
  useT,
} from "@agent-native/core/client";
import { configureTracking } from "@agent-native/core/client";
import { IconMoon, IconSun } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useCallback, useState } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useNavigate,
} from "react-router";
import type { LinksFunction } from "react-router";

import { Layout as AppLayout } from "@/components/layout/Layout";
import { useDistillationBridge } from "@/hooks/use-distillation-bridge";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { TAB_ID } from "@/lib/tab-id";

import changelog from "../CHANGELOG.md?raw";
import { i18nCatalog } from "./i18n";

import stylesheet from "./global.css?url";

configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-brain",
  }),
});

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

const THEME_INIT_SCRIPT_SELECTOR = "script[data-agent-native-theme-init]";

function getHydrationStableThemeInitScript() {
  if (typeof document !== "undefined") {
    const existing = document.querySelector<HTMLScriptElement>(
      THEME_INIT_SCRIPT_SELECTOR,
    );
    if (existing?.innerHTML) return existing.innerHTML;
  }
  return getThemeInitScript();
}

const THEME_INIT_SCRIPT = getHydrationStableThemeInitScript();
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
          data-agent-native-theme-init
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <script
          data-agent-native-locale-init
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: LOCALE_INIT_SCRIPT }}
        />
        <link rel="manifest" href={appPath("/manifest.json")} />
        <meta name="theme-color" content="#18181b" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Brain" />
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

function DbSyncSetup() {
  const qc = useQueryClient();
  useNavigationState();
  useDistillationBridge();
  useDbSync({
    queryClient: qc,
    queryKeys: [
      "action",
      "search-everything",
      "search-knowledge",
      "list-captures",
      "list-proposals",
      "review-proposal",
      "list-sources",
      "update-source",
      "sync-source",
      "enqueue-distillation",
      "claim-distillation",
      "mark-capture-distilled",
      "list-distillation-queue",
      "retry-distillation",
      "get-brain-settings",
      "update-brain-settings",
    ],
    ignoreSource: TAB_ID,
  });
  return null;
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
  const navigate = useNavigate();
  const t = useT();
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
  return (
    <>
      <CommandMenu
        open={cmdkOpen}
        onOpenChange={setCmdkOpen}
        changelog={changelog}
        changelogKey="brain"
      >
        <CommandMenu.Group heading={t("root.commandNavigate")}>
          <CommandMenu.Item onSelect={() => navigate("/")}>
            {t("navigation.askBrain")}
          </CommandMenu.Item>
          <CommandMenu.Item onSelect={() => navigate("/search")}>
            {t("navigation.search")}
          </CommandMenu.Item>
          <CommandMenu.Item onSelect={() => navigate("/knowledge")}>
            {t("navigation.knowledge")}
          </CommandMenu.Item>
          <CommandMenu.Item onSelect={() => navigate("/review")}>
            {t("navigation.reviewQueue")}
          </CommandMenu.Item>
          <CommandMenu.Item onSelect={() => navigate("/sources")}>
            {t("navigation.sources")}
          </CommandMenu.Item>
          <CommandMenu.Item onSelect={() => navigate("/ops")}>
            {t("navigation.ops")}
          </CommandMenu.Item>
          <CommandMenu.Item onSelect={() => navigate("/extensions")}>
            {t("navigation.extensions")}
          </CommandMenu.Item>
          <CommandMenu.Item onSelect={() => navigate("/settings")}>
            {t("navigation.settings")}
          </CommandMenu.Item>
        </CommandMenu.Group>
        <CommandMenu.Group heading={t("root.commandAppearance")}>
          <ThemeToggleItem />
        </CommandMenu.Group>
      </CommandMenu>
      <AppLayout>
        <Outlet />
      </AppLayout>
    </>
  );
}

export default function Root() {
  const [queryClient] = useState(() =>
    createAgentNativeQueryClient({
      defaultOptions: {
        queries: {
          // Brain has a faster sync cadence for source distillation status;
          // 20 s keeps the source list fresh without hammering the server.
          staleTime: 20_000,
          // Brain shows live ingestion progress — refetch on focus to pick
          // up background sync jobs that don't emit DB events.
          refetchOnWindowFocus: true,
          // Flat retry: Brain data fetches are rarely auth failures so a
          // flat count is sufficient.
          retry: 1,
        },
      },
    }),
  );

  return (
    <AppProviders
      queryClient={queryClient}
      tooltipDelayDuration={250}
      i18n={{ catalog: i18nCatalog }}
    >
      <DbSyncSetup />
      <AppContent />
    </AppProviders>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
