import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useCallback, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useFileWatcher } from "@agent-native/core";
import {
  ClientOnly,
  CommandMenu,
  DefaultSpinner,
  useCommandMenuShortcut,
} from "@agent-native/core/client";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./global.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#71717A" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Starter" />
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

const TAB_ID = Math.random().toString(36).slice(2, 10);

function FileWatcherSetup() {
  const qc = useQueryClient();
  useFileWatcher({
    queryClient: qc,
    queryKeys: ["files", "data"],
    ignoreSource: TAB_ID,
  });
  return null;
}

export default function Root() {
  const [queryClient] = useState(() => new QueryClient());
  const [cmdkOpen, setCmdkOpen] = useState(false);
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
  return (
    <ClientOnly fallback={<DefaultSpinner />}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <FileWatcherSetup />
            <CommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen}>
              <CommandMenu.Group heading="Actions">
                <CommandMenu.Item onSelect={() => {}}>Search</CommandMenu.Item>
              </CommandMenu.Group>
            </CommandMenu>
            <Outlet />
            <Toaster position="bottom-left" />
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ClientOnly>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
