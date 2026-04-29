import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useEffect, useRef, useState } from "react";
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
    app: "agent-native-mail",
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
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#3B82F6" />
        <meta name="mobile-web-app-capable" content="yes" />
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
    const handleFocusRestore = () => window.focus();
    document.addEventListener("visibilitychange", handleVisibility);
    document.addEventListener("click", handleFocusRestore, true);
    // Restore focus when cursor re-enters the app (e.g. after using the agent chat panel)
    document.documentElement.addEventListener("mouseenter", handleFocusRestore);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      document.removeEventListener("click", handleFocusRestore, true);
      document.documentElement.removeEventListener(
        "mouseenter",
        handleFocusRestore,
      );
    };
  }, []);
  return null;
}

/** Trigger automation processing on window focus and initial load */
function AutomationTrigger() {
  const lastTrigger = useRef(0);
  useEffect(() => {
    const trigger = () => {
      const now = Date.now();
      if (now - lastTrigger.current < 30_000) return;
      lastTrigger.current = now;
      fetch("/api/automations/trigger", { method: "POST" }).catch(() => {});
    };
    // Trigger on load
    trigger();
    // Trigger on window focus
    const onVisibility = () => {
      if (document.visibilityState === "visible") trigger();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  return null;
}

/** Invalidate email queries when the window regains visibility */
function VisibilityRefresh() {
  const qc = useQueryClient();
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        qc.invalidateQueries({ queryKey: ["emails"] });
        qc.invalidateQueries({ queryKey: ["labels"] });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [qc]);
  return null;
}

function DbSyncSetup() {
  const qc = useQueryClient();

  useDbSync({
    queryClient: qc,
    queryKeys: [],
    // Skip events this tab caused — our mutations already handle cache updates
    ignoreSource: TAB_ID,
    onEvent: (data: {
      source?: string;
      type: string;
      path?: string;
      key?: string;
      requestSource?: string;
    }) => {
      // Ignore events we caused — the mutation's onSettled handles our own updates
      const isOwnEvent = data.requestSource === TAB_ID;

      if (data.source === "app-state") {
        if (
          (data.key?.startsWith("compose-") || data.key === "*") &&
          !isOwnEvent
        ) {
          qc.invalidateQueries({
            queryKey: ["compose-drafts"],
            refetchType: "all",
          });
        }
        if (!isOwnEvent) {
          qc.invalidateQueries({ queryKey: ["navigate-command"] });
        }
      } else if (data.source === "settings") {
        if (!isOwnEvent) {
          qc.invalidateQueries({ queryKey: ["settings"] });
          qc.invalidateQueries({ queryKey: ["aliases"] });
          qc.invalidateQueries({ queryKey: ["labels"] });
          qc.invalidateQueries({ queryKey: ["emails"] });
          qc.invalidateQueries({ queryKey: ["email"] });
        }
      } else if (!isOwnEvent) {
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
            <AutomationTrigger />
            <VisibilityRefresh />
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
