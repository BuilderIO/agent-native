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
import { Toaster } from "@/components/ui/toaster";
import {
  ClientOnly,
  CommandMenu,
  DefaultSpinner,
  enterStyleEditing as coreEnterStyleEditing,
  enterTextEditing as coreEnterTextEditing,
  exitSelectionMode as coreExitSelectionMode,
  useCommandMenuShortcut,
  useDbSync,
} from "@agent-native/core/client";
import { Layout as AppLayout } from "@/components/layout/Layout";
import { IconSun, IconMoon } from "@tabler/icons-react";
import { ThemeProvider, useTheme } from "next-themes";
import { useQueryClient } from "@tanstack/react-query";
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
  const qc = useQueryClient();
  useDbSync({ queryClient: qc, queryKeys: ["action"] });
  const { theme, setTheme } = useTheme();
  const [cmdkOpen, setCmdkOpen] = useState(false);
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
  const location = useLocation();

  const isBare =
    BARE_ROUTES.has(location.pathname) ||
    BARE_PREFIXES.some((p) => location.pathname.startsWith(p)) ||
    location.pathname.endsWith("/present");

  if (isBare) {
    return (
      <DeckProvider key={DECK_KEY}>
        <Outlet />
      </DeckProvider>
    );
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
        <AppLayout>
          <Outlet />
        </AppLayout>
      </DeckProvider>
    </>
  );
}

export default function Root() {
  const [queryClient] = useState(() => new QueryClient());
  const location = useLocation();

  if (BARE_PREFIXES.some((p) => location.pathname.startsWith(p))) {
    return <Outlet />;
  }

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
            {/* Global Toaster — sibling of AppContent so toasts render on
                every route (including bare /slide, /share/*, presentation
                mode) and across both the editor and the home shell.
                Without this mount, every toast() call queues but nothing
                appears in the DOM (caught by browser tests TC-06–10). */}
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ClientOnly>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
