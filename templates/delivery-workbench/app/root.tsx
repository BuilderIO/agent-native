import {
  AppProviders,
  ErrorBoundary,
  createAgentNativeQueryClient,
  getThemeInitScript,
  useDbSync,
} from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { LinksFunction } from "react-router";

import { AppLayout } from "@/components/AppLayout";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { TAB_ID } from "@/lib/tab-id";

import { i18nCatalog } from "./i18n";

import stylesheet from "./global.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

const THEME_INIT_SCRIPT = getThemeInitScript("light", true);

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script
          data-agent-native-theme-init
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
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
  const queryClient = useQueryClient();

  useDbSync({
    queryClient,
    ignoreSource: TAB_ID,
    onEvent: (event: {
      source?: string;
      type: string;
      key?: string;
      requestSource?: string;
    }) => {
      if (event.requestSource === TAB_ID) return;
      if (event.source === "app-state") {
        queryClient.invalidateQueries({ queryKey: ["navigate-command"] });
      }
    },
  });

  return null;
}

function NavigationSetup() {
  useNavigationState();
  return null;
}

export default function Root() {
  const [queryClient] = useState(() =>
    createAgentNativeQueryClient({
      defaultOptions: {
        queries: {
          refetchOnWindowFocus: true,
          retry: 1,
        },
      },
    }),
  );

  return (
    <AppProviders
      queryClient={queryClient}
      defaultTheme="light"
      tooltipDelayDuration={250}
      i18n={{ catalog: i18nCatalog }}
    >
      <DbSyncSetup />
      <NavigationSetup />
      <AppLayout>
        <Outlet />
      </AppLayout>
    </AppProviders>
  );
}

export { ErrorBoundary };
