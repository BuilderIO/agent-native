import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useDbSync } from "@agent-native/core";
import { ClientOnly, DefaultSpinner } from "@agent-native/core/client";
import { TAB_ID } from "@/lib/tab-id";
import { AppLayout } from "@/components/layout/AppLayout";
import "./global.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
        />
        <link
          rel="icon"
          type="image/svg+xml"
          href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🥗</text></svg>"
        />
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

      // When data changes from agent or another tab, invalidate all action
      // queries so list-meals, list-exercises, list-weights, get-analytics,
      // etc. all refetch. useActionQuery keys are ["action", name, params].
      qc.invalidateQueries({ queryKey: ["action"] });

      if (data.source === "app-state") {
        qc.invalidateQueries({ queryKey: ["navigate-command"] });
      }
    },
  });
  return null;
}

export default function Root() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );

  return (
    <ClientOnly fallback={<DefaultSpinner />}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider delayDuration={300}>
            <Toaster richColors position="bottom-left" />
            <DbSyncSetup />
            <AppLayout>
              <Outlet />
            </AppLayout>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ClientOnly>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
