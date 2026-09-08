import { configureTracking } from "@agent-native/core/client/analytics";
import { appPath } from "@agent-native/core/client/api-path";
import {
  AppProviders,
  createAgentNativeQueryClient,
  useDbSync,
} from "@agent-native/core/client/hooks";
import { getLocaleInitScript } from "@agent-native/core/client/i18n";
import { getThemeInitScript } from "@agent-native/core/client/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "react-router";
import type { LinksFunction } from "react-router";

import { CrmCommandMenu } from "@/components/layout/CrmCommandMenu";
import { CrmLayout } from "@/components/layout/CrmLayout";
import { AppToolkitProvider } from "@/components/ui/toolkit-provider";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { i18nCatalog } from "@/i18n";
import { TAB_ID } from "@/lib/tab-id";

import stylesheet from "./global.css?url";

configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "crm",
    template: "crm",
  }),
});

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

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
          dangerouslySetInnerHTML={{ __html: getThemeInitScript() }}
        />
        <script
          data-agent-native-locale-init
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: getLocaleInitScript() }}
        />
        <meta name="theme-color" content="#71717A" />
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

function SyncBridge() {
  const queryClient = useQueryClient();
  useNavigationState();
  useDbSync({ queryClient, ignoreSource: TAB_ID });
  return null;
}

function AppContent() {
  return (
    <>
      <SyncBridge />
      <CrmCommandMenu />
      <CrmLayout>
        <Outlet />
      </CrmLayout>
    </>
  );
}

export default function Root() {
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  const location = useLocation();
  const isMarketingPath = location.pathname === "/";
  return (
    <AppToolkitProvider>
      <AppProviders
        queryClient={queryClient}
        isPublicPath={isMarketingPath}
        i18n={{ catalog: i18nCatalog }}
      >
        {isMarketingPath ? <Outlet /> : <AppContent />}
      </AppProviders>
    </AppToolkitProvider>
  );
}

export { ErrorBoundary } from "@agent-native/core/client/ui";
