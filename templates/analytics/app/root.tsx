import {
  AppProviders,
  appPath,
  createAgentNativeQueryClient,
  getLocaleInitScript,
  getThemeInitScript,
  useDbSync,
} from "@agent-native/core/client";
import { configureTracking } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { LinksFunction } from "react-router";

import { AuthProvider } from "@/components/auth/AuthProvider";
import { ProviderCorpusJobNotifier } from "@/components/ProviderCorpusJobNotifier";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TAB_ID } from "@/lib/tab-id";

import { CommandPalette } from "./components/layout/CommandPalette";
import { Layout as AppLayout } from "./components/layout/Layout";
import { i18nCatalog } from "./i18n";

import stylesheet from "./global.css?url";
configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-analytics",
  }),
});

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

const THEME_INIT_SCRIPT = getThemeInitScript("dark", true);
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
        <meta name="theme-color" content="#F59E0B" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Analytics" />
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

function DbSyncBridge() {
  // Invalidate react-query caches on DB changes (agent edits, other tabs,
  // cron jobs). SQL chart queries can be expensive, so they stay on explicit
  // refresh/filter semantics instead of joining the broad action fallback.
  // Screen-refresh is handled automatically inside AgentSidebar.
  const queryClient = useQueryClient();
  const shouldInvalidateForAction = useCallback(
    (query: { queryKey: readonly unknown[] }) => {
      return query.queryKey[0] !== "sql-chart";
    },
    [],
  );
  useDbSync({
    queryClient,
    ignoreSource: TAB_ID,
    actionInvalidatePredicate: shouldInvalidateForAction,
  });
  return null;
}

export default function Root() {
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  return (
    // defaultTheme="dark": analytics defaults to dark mode if no stored preference.
    // toaster={null}: suppress AppProviders' built-in sonner; analytics renders
    // both its styled Sonner and the legacy shadcn Toaster explicitly below.
    <AppProviders
      queryClient={queryClient}
      defaultTheme="dark"
      toaster={null}
      i18n={{ catalog: i18nCatalog }}
    >
      <DbSyncBridge />
      <Toaster />
      <Sonner position="bottom-left" />
      <AuthProvider>
        <ProviderCorpusJobNotifier />
        <CommandPalette />
        <AppLayout>
          <Outlet />
        </AppLayout>
      </AuthProvider>
    </AppProviders>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
