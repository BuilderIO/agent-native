import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useEffect, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import { useDbSync } from "@agent-native/core";
import { ClientOnly, DefaultSpinner } from "@agent-native/core/client";
import { TAB_ID } from "@/lib/tab-id";
import type { LinksFunction } from "react-router";
import stylesheet from "./global.css?url";
import { configureTracking } from "@agent-native/core/client";
configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-issues",
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
        <link
          rel="icon"
          type="image/svg+xml"
          href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📋</text></svg>"
        />
        <meta name="theme-color" content="#2563EB" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Issues" />
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

function AutoFocus() {
  useEffect(() => {
    window.focus();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") window.focus();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    const handleClick = () => window.focus();
    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      document.removeEventListener("click", handleClick, true);
    };
  }, []);
  return null;
}

/** After OAuth redirect, clear the signin flag and refetch auth status */
function OAuthReturnHandler() {
  const qc = useQueryClient();
  useEffect(() => {
    try {
      if (sessionStorage.getItem("__an_signin")) {
        sessionStorage.removeItem("__an_signin");
        qc.invalidateQueries({ queryKey: ["jira-auth-status"] });
        qc.invalidateQueries({ queryKey: ["jira-auth-url"] });
        qc.invalidateQueries({ queryKey: ["projects"] });
        qc.invalidateQueries({ queryKey: ["boards"] });
      }
    } catch {}
  }, [qc]);
  return null;
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

      if (data.source === "app-state") {
        if (!isOwnEvent) {
          qc.invalidateQueries({ queryKey: ["navigate-command"] });
        }
      } else if (data.source === "settings") {
        if (!isOwnEvent) {
          qc.invalidateQueries({ queryKey: ["settings"] });
        }
      } else if (!isOwnEvent) {
        qc.invalidateQueries({ queryKey: ["issues"] });
        qc.invalidateQueries({ queryKey: ["issue"] });
        qc.invalidateQueries({ queryKey: ["projects"] });
        qc.invalidateQueries({ queryKey: ["boards"] });
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
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider delayDuration={300}>
            <Toaster richColors position="bottom-left" />
            <AutoFocus />
            <OAuthReturnHandler />
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
