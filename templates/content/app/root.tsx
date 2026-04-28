import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useCallback, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "next-themes";
import { IconSun, IconMoon } from "@tabler/icons-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import {
  ClientOnly,
  DefaultSpinner,
  CommandMenu,
  useCommandMenuShortcut,
} from "@agent-native/core/client";
import { useDbSync } from "./hooks/use-db-sync";
import { useNavigationState } from "./hooks/use-navigation-state";
import type { LinksFunction } from "react-router";
import stylesheet from "./global.css?url";
import { configureTracking } from "@agent-native/core/client";
configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-content",
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
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#10B981" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Content" />
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

function AppSetup() {
  useDbSync();
  useNavigationState();
  return null;
}

export default function Root() {
  const [queryClient] = useState(() => new QueryClient());
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
  return (
    <ClientOnly fallback={<DefaultSpinner />}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        <QueryClientProvider client={queryClient}>
          <AppSetup />
          <TooltipProvider>
            <Toaster />
            <Sonner position="bottom-left" />
            <CommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen}>
              <CommandMenu.Group heading="Documents">
                <CommandMenu.Item onSelect={() => {}}>
                  Search documents
                </CommandMenu.Item>
              </CommandMenu.Group>
              <CommandMenu.Group heading="Appearance">
                <CommandMenu.Item
                  onSelect={() =>
                    setTheme(theme === "dark" ? "light" : "dark")
                  }
                  keywords={["theme", "dark", "light", "mode"]}
                >
                  {theme === "dark" ? (
                    <IconSun size={16} />
                  ) : (
                    <IconMoon size={16} />
                  )}
                  Toggle {theme === "dark" ? "light" : "dark"} mode
                </CommandMenu.Item>
              </CommandMenu.Group>
            </CommandMenu>
            <Outlet />
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ClientOnly>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
