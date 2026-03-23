import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useFileWatcher } from "@agent-native/core/client";
import { Toaster } from "@/components/ui/sonner";
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
          href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📅</text></svg>"
        />
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

function FileWatcherSetup() {
  const qc = useQueryClient();
  useFileWatcher({
    queryClient: qc,
    queryKeys: [
      "events",
      "bookings",
      "availability",
      "settings",
      "google-status",
    ],
  });
  return null;
}

export default function Root() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <FileWatcherSetup />
        <Toaster />
        <Outlet />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
