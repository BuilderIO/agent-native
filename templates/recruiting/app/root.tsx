import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useCallback, useEffect, useState } from "react";
import { useNavigationState } from "@/hooks/use-navigation-state";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useTheme } from "next-themes";
import { Toaster } from "sonner";
import { AppLayout } from "@/components/layout/AppLayout";
import { useDbSync } from "@agent-native/core";
import {
  ClientOnly,
  DefaultSpinner,
  CommandMenu,
  useCommandMenuShortcut,
} from "@agent-native/core/client";
import { IconSun, IconMoon } from "@tabler/icons-react";
import { TAB_ID } from "@/lib/tab-id";
import type { LinksFunction } from "react-router";
import stylesheet from "./global.css?url";
import { configureTracking } from "@agent-native/core/client";
configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-recruiting",
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
        <meta name="theme-color" content="#16A34A" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Recruiting" />
        <Meta />
        <Links />
      </head>
      <body suppressHydrationWarning>
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

function NavigationStateSync() {
  useNavigationState();
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
      if (isOwnEvent) return;

      if (data.source === "settings") {
        qc.invalidateQueries({ queryKey: ["greenhouse-status"] });
      }

      // Refresh data queries on any external change
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["candidates"] });
      qc.invalidateQueries({ queryKey: ["interviews"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["action-items"] });
      qc.invalidateQueries({ queryKey: ["notification-status"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
    },
  });
  return null;
}

function ThemeToggleItem() {
  const { theme, setTheme } = useTheme();
  return (
    <CommandMenu.Item
      onSelect={() => setTheme(theme === "dark" ? "light" : "dark")}
      keywords={["theme", "dark", "light", "mode"]}
    >
      {theme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
      Toggle theme
    </CommandMenu.Item>
  );
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
  const [cmdkOpen, setCmdkOpen] = useState(false);
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
  return (
    <ClientOnly fallback={<DefaultSpinner />}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <Toaster richColors position="bottom-left" />
          <AutoFocus />
          <DbSyncSetup />
          <NavigationStateSync />
          <CommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen}>
            <CommandMenu.Group heading="Actions">
              <CommandMenu.Item onSelect={() => {}}>Search</CommandMenu.Item>
            </CommandMenu.Group>
            <CommandMenu.Group heading="Appearance">
              <ThemeToggleItem />
            </CommandMenu.Group>
          </CommandMenu>
          <AppLayout>
            <Outlet />
          </AppLayout>
        </ThemeProvider>
      </QueryClientProvider>
    </ClientOnly>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
