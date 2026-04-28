import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "react-router";
import { useCallback, useEffect, useState } from "react";
import { useNavigationState } from "@/hooks/use-navigation-state";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useDbSync } from "@agent-native/core";
import {
  AgentSidebar,
  AgentToggleButton,
  ClientOnly,
  CommandMenu,
  DefaultSpinner,
  useCommandMenuShortcut,
} from "@agent-native/core/client";
import { Toaster } from "sonner";
import { IconMenu2, IconSun, IconMoon } from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/layout/Sidebar";
import type { LinksFunction } from "react-router";
import stylesheet from "./global.css?url";
import { configureTracking } from "@agent-native/core/client";
configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "design",
  }),
});

/** Routes that render without the app shell */
const BARE_ROUTES = new Set<string>([]);
/** Route prefixes that render without the app shell */
const BARE_PREFIXES = ["/present/"];

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
        <meta name="theme-color" content="#71717A" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Design" />
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
  useNavigationState();
  useDbSync({
    queryClient: qc,
    queryKeys: ["designs", "design-systems", "design-files"],
    ignoreSource: TAB_ID,
  });
  return null;
}

function AppContent() {
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
  const location = useLocation();
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);
  const isBare =
    BARE_ROUTES.has(location.pathname) ||
    BARE_PREFIXES.some((p) => location.pathname.startsWith(p));

  if (isBare) {
    return <Outlet />;
  }

  return (
    <>
      <CommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen}>
        <CommandMenu.Group heading="Actions">
          <CommandMenu.Item onSelect={() => {}}>Search</CommandMenu.Item>
        </CommandMenu.Group>
        <CommandMenu.Group heading="Appearance">
          <CommandMenu.Item
            onSelect={() => setTheme(theme === "dark" ? "light" : "dark")}
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
      <AgentSidebar
        position="right"
        emptyStateText="Describe a design to create"
        suggestions={[
          "Create a todo app prototype",
          "Design a landing page for my startup",
          "Build a dashboard with charts",
        ]}
      >
        <div className="flex h-screen w-full overflow-hidden">
          {sidebarOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/50 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}
          <div
            className={cn(
              "fixed inset-y-0 left-0 z-50 md:static md:z-auto",
              sidebarOpen
                ? "translate-x-0"
                : "-translate-x-full md:translate-x-0",
            )}
          >
            <Sidebar />
          </div>
          <div className="flex h-full flex-1 flex-col overflow-hidden">
            {(() => {
              const hasOwnToolbar = location.pathname.startsWith("/tools");
              return (
                <header
                  className={cn(
                    "flex h-12 items-center justify-between border-b border-border px-4 shrink-0",
                    hasOwnToolbar && "md:hidden",
                  )}
                >
                  <button
                    onClick={() => setSidebarOpen(true)}
                    className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground md:hidden"
                  >
                    <IconMenu2 className="h-4 w-4" />
                  </button>
                  {!hasOwnToolbar && (
                    <AgentToggleButton className="ml-auto h-8 w-8 rounded-md hover:bg-accent" />
                  )}
                </header>
              );
            })()}
            <Outlet />
          </div>
        </div>
      </AgentSidebar>
      <Toaster position="bottom-left" />
    </>
  );
}

export default function Root() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <ClientOnly fallback={<DefaultSpinner />}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <DbSyncSetup />
            <AppContent />
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ClientOnly>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
