import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useCallback, useState } from "react";
import { useNavigationState } from "@/hooks/use-navigation-state";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ClientOnly,
  CommandMenu,
  DefaultSpinner,
  useCommandMenuShortcut,
  useDbSync,
} from "@agent-native/core/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout as AppLayout } from "@/components/layout/Layout";
import { IconSun, IconMoon } from "@tabler/icons-react";
import { ThemeProvider, useTheme } from "next-themes";
import type { LinksFunction } from "react-router";
import stylesheet from "./global.css?url";
import { configureTracking } from "@agent-native/core/client";
configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-videos",
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
        <meta name="theme-color" content="#EF4444" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Videos" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
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

function AppContent() {
  useNavigationState();
  const qc = useQueryClient();
  useDbSync({ queryClient: qc, queryKeys: ["action"] });
  const { theme, setTheme } = useTheme();
  const [cmdkOpen, setCmdkOpen] = useState(false);
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));

  return (
    <TooltipProvider>
      <CommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen}>
        <CommandMenu.Group heading="Videos">
          <CommandMenu.Item onSelect={() => {}}>
            Search compositions
          </CommandMenu.Item>
        </CommandMenu.Group>
        <CommandMenu.Group heading="Appearance">
          <CommandMenu.Item
            onSelect={() => setTheme(theme === "dark" ? "light" : "dark")}
            keywords={["theme", "dark", "light", "mode"]}
          >
            {theme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
            Toggle {theme === "dark" ? "light" : "dark"} mode
          </CommandMenu.Item>
        </CommandMenu.Group>
      </CommandMenu>
      <AppLayout>
        <Outlet />
      </AppLayout>
    </TooltipProvider>
  );
}

export default function Root() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <ClientOnly fallback={<DefaultSpinner />}>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
      >
        <QueryClientProvider client={queryClient}>
          <AppContent />
        </QueryClientProvider>
      </ThemeProvider>
    </ClientOnly>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
