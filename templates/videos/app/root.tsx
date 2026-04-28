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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AgentSidebar,
  ClientOnly,
  CommandMenu,
  DefaultSpinner,
  useCommandMenuShortcut,
} from "@agent-native/core/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NavSidebar } from "@/components/layout/NavSidebar";
import { IconMenu2 } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
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
    <html lang="en" className="dark">
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

/** Routes where the studio page renders its own sidebar */
const STUDIO_ROUTES = new Set(["/"]);
const STUDIO_PREFIXES = ["/c/"];

function AppContent() {
  useNavigationState();
  const [cmdkOpen, setCmdkOpen] = useState(false);
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Studio routes render their own complex sidebar with composition panels.
  // Non-studio routes get the simple nav sidebar from root.
  const isStudioRoute =
    STUDIO_ROUTES.has(location.pathname) ||
    STUDIO_PREFIXES.some((p) => location.pathname.startsWith(p));

  return (
    <TooltipProvider>
      <CommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen}>
        <CommandMenu.Group heading="Videos">
          <CommandMenu.Item onSelect={() => {}}>
            Search compositions
          </CommandMenu.Item>
        </CommandMenu.Group>
      </CommandMenu>
      {isStudioRoute ? (
        <Outlet />
      ) : (
        <AgentSidebar
          position="right"
          defaultOpen
          emptyStateText="Ask me anything about your videos"
          suggestions={[
            "Create a new composition",
            "Add a camera pan effect",
            "Adjust the animation timing",
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
              <NavSidebar />
            </div>
            <div className="flex h-full flex-1 flex-col overflow-hidden">
              <div className="flex h-12 items-center border-b border-border px-4 md:hidden">
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground"
                >
                  <IconMenu2 className="h-4 w-4" />
                </button>
              </div>
              <Outlet />
            </div>
          </div>
        </AgentSidebar>
      )}
    </TooltipProvider>
  );
}

export default function Root() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <ClientOnly fallback={<DefaultSpinner />}>
      <QueryClientProvider client={queryClient}>
        <AppContent />
      </QueryClientProvider>
    </ClientOnly>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
