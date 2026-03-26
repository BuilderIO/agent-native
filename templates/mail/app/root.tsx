import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useEffect } from "react";
import { useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/AppLayout";
import { useFileWatcher } from "@agent-native/core";
import "./global.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link
          rel="icon"
          type="image/svg+xml"
          href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📧</text></svg>"
        />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#3B82F6" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Mail" />
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

/** Ensure the app window has focus so keyboard shortcuts work immediately */
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

function FileWatcherSetup() {
  const qc = useQueryClient();
  useFileWatcher({
    queryClient: qc,
    queryKeys: [],
    onEvent: (data: {
      source?: string;
      type: string;
      path?: string;
      key?: string;
    }) => {
      if (data.source === "app-state") {
        if (data.key?.startsWith("compose-")) {
          qc.invalidateQueries({
            queryKey: ["compose-drafts"],
            refetchType: "all",
          });
        }
        qc.invalidateQueries({ queryKey: ["navigate-command"] });
      } else if (data.source === "settings") {
        qc.invalidateQueries({ queryKey: ["settings"] });
        qc.invalidateQueries({ queryKey: ["aliases"] });
        qc.invalidateQueries({ queryKey: ["labels"] });
        qc.invalidateQueries({ queryKey: ["emails"] });
        qc.invalidateQueries({ queryKey: ["email"] });
      } else {
        qc.invalidateQueries({ queryKey: ["emails"] });
        qc.invalidateQueries({ queryKey: ["email"] });
        qc.invalidateQueries({ queryKey: ["labels"] });
        qc.invalidateQueries({ queryKey: ["settings"] });
        qc.invalidateQueries({ queryKey: ["aliases"] });
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
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <TooltipProvider delayDuration={300}>
          <Toaster richColors position="bottom-right" />
          <AutoFocus />
          <FileWatcherSetup />
          <AppLayout>
            <Outlet />
          </AppLayout>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
