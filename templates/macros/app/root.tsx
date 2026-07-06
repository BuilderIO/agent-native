import { useDbSync } from "@agent-native/core/client";
import {
  AppProviders,
  CommandMenu,
  appPath,
  configureTracking,
  createAgentNativeQueryClient,
  getLocaleInitScript,
  getThemeInitScript,
  useCommandMenuShortcut,
  useT,
} from "@agent-native/core/client";
import { Toaster } from "@agent-native/toolkit/ui/sonner";
import { IconSun, IconMoon } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useCallback, useState } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { LinksFunction } from "react-router";

import { AppLayout } from "@/components/layout/AppLayout";
import { TAB_ID } from "@/lib/tab-id";

import changelog from "../CHANGELOG.md?raw";
import { i18nCatalog } from "./i18n";

import stylesheet from "./global.css?url";

configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-macros",
  }),
});

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

// Dark default: macros defaults to dark mode; enableSystem respects OS preference.
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
        <link rel="icon" type="image/svg+xml" href={appPath("/favicon.svg")} />
        <meta name="theme-color" content="#0a0a0a" />
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

  useDbSync({
    queryClient: qc,
    queryKeys: [],
    ignoreSource: TAB_ID,
    onEvent: (data: {
      source?: string;
      type: string;
      key?: string;
      requestSource?: string;
    }) => {
      const isOwnEvent = data.requestSource === TAB_ID;
      if (isOwnEvent) return;

      if (data.source === "app-state") {
        qc.invalidateQueries({ queryKey: ["navigate-command"] });
      }
    },
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

function MacrosCommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <CommandMenu
      open={open}
      onOpenChange={onOpenChange}
      changelog={changelog}
      changelogKey="macros"
    >
      <CommandMenu.Group heading={t("root.commandActions")}>
        <CommandMenu.Item onSelect={() => {}}>
          {t("root.search")}
        </CommandMenu.Item>
      </CommandMenu.Group>
      <CommandMenu.Group heading={t("root.appearance")}>
        <ThemeToggleItem />
      </CommandMenu.Group>
    </CommandMenu>
  );
}

export default function Root() {
  const [queryClient] = useState(() =>
    createAgentNativeQueryClient({
      defaultOptions: {
        queries: {
          // Macros UI refetches on focus to pick up meals logged in other
          // browser tabs or mobile, which don't always arrive via DB sync.
          refetchOnWindowFocus: true,
          // Flat retry: macros data errors are usually transient network
          // issues, not auth failures, so a flat count is sufficient.
          retry: 1,
        },
      },
    }),
  );
  const [cmdkOpen, setCmdkOpen] = useState(false);
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));

  return (
    <AppProviders
      queryClient={queryClient}
      defaultTheme="dark"
      tooltipDelayDuration={300}
      toaster={<Toaster richColors position="bottom-left" />}
      i18n={{ catalog: i18nCatalog }}
    >
      <DbSyncSetup />
      <MacrosCommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen} />
      <AppLayout>
        <Outlet />
      </AppLayout>
    </AppProviders>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
