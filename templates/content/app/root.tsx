import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLocation,
  useRouteError,
} from "react-router";
import { useCallback, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useTheme } from "next-themes";
import { IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import {
  ClientOnly,
  DefaultSpinner,
  AgentSidebar,
  appPath,
  CommandMenu,
  useCommandMenuShortcut,
} from "@agent-native/core/client";
import { useDbSync } from "./hooks/use-db-sync";
import { useNavigationState } from "./hooks/use-navigation-state";
import type { LinksFunction } from "react-router";
import stylesheet from "./global.css?url";
import { configureTracking } from "@agent-native/core/client";
import { getThemeInitScript } from "@agent-native/core/client";
configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-content",
  }),
});

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

const THEME_INIT_SCRIPT = getThemeInitScript("system", true);

const themeOptions = [
  { value: "system", label: "System", icon: IconDeviceDesktop },
  { value: "light", label: "Light", icon: IconSun },
  { value: "dark", label: "Dark", icon: IconMoon },
] as const;

const THEME_PREFERENCE_STORAGE_KEY = "content-theme-preference";

type ThemeOption = (typeof themeOptions)[number]["value"];

function isThemeOption(value: string | null | undefined): value is ThemeOption {
  return value === "light" || value === "system" || value === "dark";
}

function readStoredThemePreference(): ThemeOption {
  if (typeof window === "undefined") return "system";

  try {
    const storedTheme = window.localStorage.getItem(
      THEME_PREFERENCE_STORAGE_KEY,
    );
    if (storedTheme === "auto") return "system";
    return isThemeOption(storedTheme) ? storedTheme : "system";
  } catch {
    return "system";
  }
}

function writeStoredThemePreference(theme: ThemeOption) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, theme);
  } catch {
    // Ignore storage failures and still let next-themes update the page.
  }
}

function nextTheme(theme: ThemeOption): ThemeOption {
  const currentIndex = themeOptions.findIndex(
    (option) => option.value === theme,
  );
  return themeOptions[(currentIndex + 1) % themeOptions.length].value;
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
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <link rel="manifest" href={appPath("/manifest.json")} />
        <meta name="theme-color" content="#10B981" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Content" />
        <link rel="icon" type="image/svg+xml" href={appPath("/favicon.svg")} />
        <link rel="apple-touch-icon" href={appPath("/icon-180.svg")} />
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

function ThemeToggleItem() {
  const { theme, setTheme } = useTheme();
  const [selectedTheme, setSelectedTheme] = useState<ThemeOption>("system");

  useEffect(() => {
    setSelectedTheme(readStoredThemePreference());
  }, [theme]);

  const activeTheme = selectedTheme;
  const activeOption =
    themeOptions.find((option) => option.value === activeTheme) ??
    themeOptions[0];
  const ActiveIcon = activeOption.icon;
  const handleSelect = () => {
    const next = nextTheme(activeTheme);
    setSelectedTheme(next);
    writeStoredThemePreference(next);
    setTheme(next);
  };

  return (
    <CommandMenu.Item
      onSelect={handleSelect}
      keywords={["theme", "dark", "light", "system", "mode"]}
    >
      <ActiveIcon size={16} />
      Toggle theme
      <span className="ml-auto text-xs text-muted-foreground">
        {activeOption.label}
      </span>
    </CommandMenu.Item>
  );
}

function PublicAgentShell({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    if (!window.matchMedia("(min-width: 768px)").matches) return;
    const id = window.setTimeout(() => {
      window.dispatchEvent(new Event("agent-panel:open"));
    }, 0);
    return () => window.clearTimeout(id);
  }, [mounted]);

  const content = <>{children}</>;

  if (!mounted) {
    return (
      <div className="flex min-w-0 flex-1 h-screen overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-auto">
          {content}
        </div>
      </div>
    );
  }

  return (
    <AgentSidebar
      position="right"
      defaultOpen
      defaultSidebarWidth={420}
      emptyStateText="Ask me anything about this document"
      suggestions={[
        "Summarize this document",
        "What are the key takeaways?",
        "Turn this into an action plan",
      ]}
    >
      {content}
    </AgentSidebar>
  );
}

export default function Root() {
  const [queryClient] = useState(() => new QueryClient());
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const location = useLocation();
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));

  if (location.pathname.startsWith("/p/")) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <TooltipProvider>
            <Toaster />
            <Sonner closeButton position="bottom-left" />
            <PublicAgentShell>
              <Outlet />
            </PublicAgentShell>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  return (
    <ClientOnly fallback={<DefaultSpinner />}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <QueryClientProvider client={queryClient}>
          <AppSetup />
          <TooltipProvider>
            <Toaster />
            <Sonner closeButton position="bottom-left" />
            <CommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen}>
              <CommandMenu.Group heading="Content">
                <CommandMenu.Item onSelect={() => {}}>
                  Search documents
                </CommandMenu.Item>
              </CommandMenu.Group>
              <CommandMenu.Group heading="Appearance">
                <ThemeToggleItem />
              </CommandMenu.Group>
            </CommandMenu>
            <Outlet />
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ClientOnly>
  );
}

function ContentErrorBoundaryBody() {
  const error = useRouteError();
  let title = "Something went wrong";
  let details = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = "Page not found";
      details = "We couldn't find this page.";
    } else {
      title = `${error.status} Error`;
      details = error.statusText || details;
    }
  } else if (error instanceof Error && error.message) {
    details = error.message;
  } else if (typeof error === "string" && error) {
    details = error;
  }

  if (typeof console !== "undefined" && error) {
    console.error("[ContentErrorBoundary]", error);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <div className="flex max-w-md flex-col items-center text-center">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{details}</p>
        <a
          href={appPath("/page")}
          className="mt-6 inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
        >
          Go to page list
        </a>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-accent"
        >
          Reload
        </button>
      </div>
    </main>
  );
}

export function ErrorBoundary() {
  return <ContentErrorBoundaryBody />;
}
