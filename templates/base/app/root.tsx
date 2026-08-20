import { configureTracking } from "@agent-native/core/client/analytics";
import { appPath } from "@agent-native/core/client/api-path";
import { useDbSync } from "@agent-native/core/client/hooks";
import {
  AppProviders,
  createAgentNativeQueryClient,
} from "@agent-native/core/client/hooks";
import { getThemeInitScript } from "@agent-native/core/client/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import { AppToolkitProvider } from "./components/ui/toolkit-provider";
import { useNavigationState } from "./hooks/use-navigation-state";
import { APP_TITLE } from "./lib/app-config";
import { TAB_ID } from "./lib/tab-id";

configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "base",
  }),
});
import "./global.css";

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
        <link rel="icon" type="image/svg+xml" href={appPath("/favicon.svg")} />
        {/* guard:allow-raw-color - theme-color metadata requires a concrete browser-chrome color. */}
        <meta name="theme-color" content="#111111" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content={APP_TITLE} />
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
  useDbSync({ queryClient: qc, ignoreSource: TAB_ID });
  return null;
}

export default function Root() {
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  return (
    <AppProviders queryClient={queryClient}>
      <AppToolkitProvider>
        <DbSyncSetup />
        <Outlet />
      </AppToolkitProvider>
    </AppProviders>
  );
}

export { ErrorBoundary } from "@agent-native/core/client/ui";
