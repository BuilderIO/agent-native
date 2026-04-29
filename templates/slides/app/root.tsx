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
import { DeckProvider } from "@/context/DeckContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  AgentSidebar,
  AgentToggleButton,
  ClientOnly,
  CommandMenu,
  DefaultSpinner,
  enterStyleEditing as coreEnterStyleEditing,
  enterTextEditing as coreEnterTextEditing,
  exitSelectionMode as coreExitSelectionMode,
  useCommandMenuShortcut,
} from "@agent-native/core/client";
import { InvitationBanner } from "@agent-native/core/client/org";
import { Sidebar } from "@/components/layout/Sidebar";
import { cn } from "@/lib/utils";
import { IconMenu2, IconSun, IconMoon } from "@tabler/icons-react";
import { ThemeProvider, useTheme } from "next-themes";
import type { LinksFunction } from "react-router";
import stylesheet from "./global.css?url";
import { configureTracking } from "@agent-native/core/client";
configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-slides",
  }),
});

/** Routes that render without the app shell (sidebar + AgentSidebar) */
const BARE_ROUTES = new Set(["/slide"]);
/** Route prefixes that render without the app shell */
const BARE_PREFIXES = ["/share/"];

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

// Key forces DeckProvider remount when code changes (HMR)
const DECK_KEY = 3;

/** Track whether we (the app) put the user into selection mode via a slide click */
let weEnteredSelectionMode = false;

/** Helper to send selection mode messages and track state */
export function enterSelectionMode(
  type: "builder.enterStyleEditing" | "builder.enterTextEditing",
  data: { selector: string },
) {
  weEnteredSelectionMode = true;
  if (type === "builder.enterStyleEditing") {
    coreEnterStyleEditing(data.selector);
  } else {
    coreEnterTextEditing(data.selector);
  }
}

export function exitSelectionMode() {
  weEnteredSelectionMode = false;
  coreExitSelectionMode();
}

function useExitSelectionOnOutsideClick() {
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (!weEnteredSelectionMode) return;
      const target = e.target as HTMLElement;
      if (
        target.closest(".slide-content") ||
        target.closest(".slide-image-clickable")
      ) {
        return;
      }
      exitSelectionMode();
    };
    window.addEventListener("pointerdown", handler, { capture: true });
    return () =>
      window.removeEventListener("pointerdown", handler, { capture: true });
  }, []);
}

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
        <meta name="theme-color" content="#EC4899" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Slides" />
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
  useExitSelectionOnOutsideClick();
  useNavigationState();
  const { theme, setTheme } = useTheme();
  const [cmdkOpen, setCmdkOpen] = useState(false);
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const isBare =
    BARE_ROUTES.has(location.pathname) ||
    BARE_PREFIXES.some((p) => location.pathname.startsWith(p)) ||
    location.pathname.endsWith("/present");

  if (isBare) {
    return <Outlet />;
  }

  return (
    <>
      <CommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen}>
        <CommandMenu.Group heading="Presentations">
          <CommandMenu.Item onSelect={() => {}}>Search decks</CommandMenu.Item>
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
      <DeckProvider key={DECK_KEY}>
        <AgentSidebar
          position="right"
          defaultOpen
          emptyStateText="Ask me anything about your presentations"
          suggestions={[
            "Create a new deck",
            "Generate slides about AI",
            "Add an image to this slide",
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
                const hasOwnToolbar =
                  location.pathname.startsWith("/deck/") ||
                  location.pathname.startsWith("/tools");
                return (
                  <header
                    className={cn(
                      "flex h-12 items-center justify-between border-b border-border px-4 shrink-0",
                      hasOwnToolbar && "md:hidden",
                    )}
                  >
                    <button
                      onClick={() => setSidebarOpen(true)}
                      className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground md:hidden"
                    >
                      <IconMenu2 className="h-4 w-4" />
                    </button>
                    {!hasOwnToolbar && (
                      <AgentToggleButton className="ml-auto h-8 w-8 rounded-md hover:bg-accent" />
                    )}
                  </header>
                );
              })()}
              <InvitationBanner />
              <Outlet />
            </div>
          </div>
        </AgentSidebar>
      </DeckProvider>
    </>
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
          <TooltipProvider>
            <AppContent />
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ClientOnly>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
