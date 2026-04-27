import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useDbSync } from "@agent-native/core";
import { ClientOnly, DefaultSpinner } from "@agent-native/core/client";
import { ToolsSidebarSection } from "@agent-native/core/client/tools";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IconMenu2, IconX } from "@tabler/icons-react";
import type { LinksFunction } from "react-router";
import stylesheet from "./global.css?url";

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
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function AppShell() {
  useDbSync();
  const [panelOpen, setPanelOpen] = useState(false);

  return (
    <TooltipProvider>
      <div className="relative min-h-screen">
        <button
          onClick={() => setPanelOpen(true)}
          className="fixed left-3 top-3 z-40 flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground"
          aria-label="Open menu"
        >
          <IconMenu2 className="h-4 w-4" />
        </button>

        {panelOpen && (
          <div
            className="fixed inset-0 z-50 bg-black/50"
            onClick={() => setPanelOpen(false)}
          />
        )}

        <div
          className={`fixed inset-y-0 left-0 z-50 w-64 border-r border-border bg-background p-4 ${
            panelOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-semibold text-foreground">Voice</span>
            <button
              onClick={() => setPanelOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
              aria-label="Close menu"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>
          <ToolsSidebarSection />
        </div>

        <Outlet />
      </div>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}

export default function App() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        <ClientOnly fallback={<DefaultSpinner />}>
          <AppShell />
        </ClientOnly>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
