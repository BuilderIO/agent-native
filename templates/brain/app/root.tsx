import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useNavigate,
} from "react-router";
import { useCallback, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "next-themes";
import { IconMoon, IconSun } from "@tabler/icons-react";
import { useDbSync } from "@agent-native/core";
import {
  ClientOnly,
  CommandMenu,
  DefaultSpinner,
  appPath,
  useCommandMenuShortcut,
} from "@agent-native/core/client";
import { getThemeInitScript } from "@agent-native/core/client";
import { configureTracking } from "@agent-native/core/client";
import { Layout as AppLayout } from "@/components/layout/Layout";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useDistillationBridge } from "@/hooks/use-distillation-bridge";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { TAB_ID } from "@/lib/tab-id";
import type { LinksFunction } from "react-router";
import stylesheet from "./global.css?url";

configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-brain",
  }),
});

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

const THEME_INIT_SCRIPT_SELECTOR = "script[data-agent-native-theme-init]";

function getHydrationStableThemeInitScript() {
  if (typeof document !== "undefined") {
    const existing = document.querySelector<HTMLScriptElement>(
      THEME_INIT_SCRIPT_SELECTOR,
    );
    if (existing?.innerHTML) return existing.innerHTML;
  }
  return getThemeInitScript();
}

const THEME_INIT_SCRIPT = getHydrationStableThemeInitScript();

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
          data-agent-native-theme-init
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <link rel="manifest" href={appPath("/manifest.json")} />
        <meta name="theme-color" content="#18181b" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Brain" />
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

function DbSyncSetup() {
  const qc = useQueryClient();
  useNavigationState();
  useDistillationBridge();
  useDbSync({
    queryClient: qc,
    queryKeys: [
      "action",
      "search-everything",
      "search-knowledge",
      "list-captures",
      "list-proposals",
      "review-proposal",
      "list-sources",
      "update-source",
      "sync-source",
      "enqueue-distillation",
      "claim-distillation",
      "mark-capture-distilled",
      "list-distillation-queue",
      "retry-distillation",
      "get-brain-settings",
      "update-brain-settings",
    ],
    ignoreSource: TAB_ID,
  });
  return null;
}

function ThemeToggleItem() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return (
    <CommandMenu.Item
      onSelect={() => setTheme(isDark ? "light" : "dark")}
      keywords={["theme", "dark", "light", "mode"]}
    >
      {isDark ? <IconSun size={16} /> : <IconMoon size={16} />}
      Toggle {isDark ? "light" : "dark"} mode
    </CommandMenu.Item>
  );
}

function AppContent() {
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const navigate = useNavigate();
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
  return (
    <>
      <CommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen}>
        <CommandMenu.Group heading="Navigate">
          <CommandMenu.Item onSelect={() => navigate("/")}>
            Ask Brain
          </CommandMenu.Item>
          <CommandMenu.Item onSelect={() => navigate("/search")}>
            Search
          </CommandMenu.Item>
          <CommandMenu.Item onSelect={() => navigate("/knowledge")}>
            Knowledge
          </CommandMenu.Item>
          <CommandMenu.Item onSelect={() => navigate("/review")}>
            Review queue
          </CommandMenu.Item>
          <CommandMenu.Item onSelect={() => navigate("/sources")}>
            Sources
          </CommandMenu.Item>
          <CommandMenu.Item onSelect={() => navigate("/ops")}>
            Ops
          </CommandMenu.Item>
          <CommandMenu.Item onSelect={() => navigate("/extensions")}>
            Extensions
          </CommandMenu.Item>
          <CommandMenu.Item onSelect={() => navigate("/settings")}>
            Settings
          </CommandMenu.Item>
        </CommandMenu.Group>
        <CommandMenu.Group heading="Appearance">
          <ThemeToggleItem />
        </CommandMenu.Group>
      </CommandMenu>
      <AppLayout>
        <Outlet />
      </AppLayout>
      <Toaster richColors position="bottom-left" />
    </>
  );
}

export default function Root() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 20_000,
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );

  return (
    <ClientOnly fallback={<DefaultSpinner />}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delayDuration={250}>
            <DbSyncSetup />
            <AppContent />
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ClientOnly>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
