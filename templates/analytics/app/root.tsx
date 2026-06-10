import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import {
  AppProviders,
  appPath,
  createAgentNativeQueryClient,
  getThemeInitScript,
  useDbSync,
} from "@agent-native/core/client";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { CommandPalette } from "./components/layout/CommandPalette";
import { Layout as AppLayout } from "./components/layout/Layout";
import type { LinksFunction } from "react-router";
import stylesheet from "./global.css?url";
import { TAB_ID } from "@/lib/tab-id";
import { configureTracking } from "@agent-native/core/client";
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
  // cron jobs). The hook invalidates every active query on any non-own
  // change event, so we no longer need to enumerate dashboard / analysis
  // / explorer keys here. Screen-refresh is handled automatically inside
  // AgentSidebar.
  const queryClient = useQueryClient();
  useDbSync({ queryClient, ignoreSource: TAB_ID });
  return null;
}

export default function Root() {
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  return (
    // defaultTheme="dark": analytics defaults to dark mode if no stored preference.
    // toaster={null}: suppress AppProviders' built-in sonner; analytics renders
    // both its styled Sonner and the legacy shadcn Toaster explicitly below.
    <AppProviders queryClient={queryClient} defaultTheme="dark" toaster={null}>
      <DbSyncBridge />
      <Toaster />
      <Sonner position="bottom-left" />
      <AuthProvider>
        <CommandPalette />
        <AppLayout>
          <Outlet />
        </AppLayout>
      </AuthProvider>
    </AppProviders>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
