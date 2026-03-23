import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { BuilderAuthProvider } from "@/components/builder/BuilderAuthContext";
import { useFileWatcher } from "./hooks/use-file-watcher";
import { Pinpoint } from "@agent-native/pinpoint/react";
import "./global.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
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
  useFileWatcher();
  return null;
}

export default function Root() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <QueryClientProvider client={queryClient}>
        <FileWatcherSetup />
        <Pinpoint
          author="Vishwas"
          colorScheme="auto"
          endpoint="/api/pins"
          autoSubmit
        />
        <BuilderAuthProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <Outlet />
          </TooltipProvider>
        </BuilderAuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
