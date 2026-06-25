import {
  AppProviders,
  CommandMenu,
  appPath,
  createAgentNativeQueryClient,
  useCommandMenuShortcut,
  useDbSync,
  useT,
} from "@agent-native/core/client";
import {
  configureTracking,
  getLocaleInitScript,
  getThemeInitScript,
} from "@agent-native/core/client";
import { IconSun, IconMoon } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useCallback, useState } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { LinksFunction } from "react-router";

import { Layout as AppLayout } from "@/components/layout/Layout";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { TAB_ID } from "@/lib/tab-id";

import changelog from "../CHANGELOG.md?raw";
import { i18nCatalog } from "./i18n";

import stylesheet from "./global.css?url";
configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-videos",
  }),
});

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

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
        <link rel="manifest" href={appPath("/manifest.json")} />
        <meta name="theme-color" content="#EF4444" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Videos" />
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

function AppContent() {
  useNavigationState();
  const qc = useQueryClient();
  useDbSync({
    queryClient: qc,
    queryKeys: ["action", "env-status"],
    ignoreSource: TAB_ID,
  });
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const t = useT();
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));

  return (
    <>
      <CommandMenu
        open={cmdkOpen}
        onOpenChange={setCmdkOpen}
        changelog={changelog}
        changelogKey="videos"
      >
        <CommandMenu.Group heading={t("root.commandVideos")}>
          <CommandMenu.Item onSelect={() => {}}>
            {t("root.searchCompositions")}
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
      <AppLayout>
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
      defaultTheme="dark"
      i18n={{ catalog: i18nCatalog }}
    >
      <AppContent />
    </AppProviders>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
