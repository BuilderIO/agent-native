import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useDbSync } from "@agent-native/core/client";
import { ClientOnly, DefaultSpinner } from "@agent-native/core/client";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
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
          href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📅</text></svg>"
        />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#8B5CF6" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Calendar" />
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

function DbSyncSetup() {
  const qc = useQueryClient();
  useDbSync({
    queryClient: qc,
    queryKeys: [
      "events",
      "bookings",
      "booking-links",
      "availability",
      "settings",
      "google-status",
    ],
    ignoreSource: TAB_ID,
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
          <TooltipProvider>
            <DbSyncSetup />
            <Toaster position="bottom-left" />
            <Outlet />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ClientOnly>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
