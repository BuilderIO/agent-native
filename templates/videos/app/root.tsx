import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useCallback, useState } from "react";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ClientOnly,
  CommandMenu,
  DefaultSpinner,
  useCommandMenuShortcut,
} from "@agent-native/core/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./global.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#EF4444" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Videos" />
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

function AppContent() {
  useNavigationState();
  const [cmdkOpen, setCmdkOpen] = useState(false);
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
  return (
    <TooltipProvider>
      <CommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen}>
        <CommandMenu.Group heading="Videos">
          <CommandMenu.Item onSelect={() => {}}>
            Search compositions
          </CommandMenu.Item>
        </CommandMenu.Group>
      </CommandMenu>
      <Outlet />
    </TooltipProvider>
  );
}

export default function Root() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <ClientOnly fallback={<DefaultSpinner />}>
      <QueryClientProvider client={queryClient}>
        <AppContent />
      </QueryClientProvider>
    </ClientOnly>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
