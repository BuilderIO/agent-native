import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import {
  ClientOnly,
  DefaultSpinner,
  useDbSync,
} from "@agent-native/core/client";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { CommandPalette } from "./components/layout/CommandPalette";
import { Layout as AppLayout } from "./components/layout/Layout";
import type { LinksFunction } from "react-router";
import stylesheet from "./global.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
        />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#F59E0B" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Analytics" />
        <link rel="apple-touch-icon" href="/icon-180.svg" />
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

function DbSyncBridge({ queryClient }: { queryClient: QueryClient }) {
  // Invalidate react-query caches on DB changes (agent edits, other tabs,
  // cron jobs). Screen-refresh is handled automatically inside AgentSidebar.
  useDbSync({
    queryClient,
    queryKeys: [
      "data",
      "sql-dashboards-sidebar",
      "sql-dashboards-palette",
      "dashboard-views",
      "all-dashboard-views",
    ],
  });
  return null;
}

export default function Root() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <ClientOnly fallback={<DefaultSpinner />}>
      <QueryClientProvider client={queryClient}>
        <DbSyncBridge queryClient={queryClient} />
        <TooltipProvider>
          <Toaster />
          <Sonner position="bottom-left" />
          <AuthProvider>
            <CommandPalette />
            <AppLayout>
              <Outlet />
            </AppLayout>
          </AuthProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ClientOnly>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
