import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useCallback, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "next-themes";
import { useDbSync } from "@agent-native/core";
import {
  AgentSidebar,
  ClientOnly,
  CommandMenu,
  DefaultSpinner,
  appPath,
  useCommandMenuShortcut,
  configureTracking,
  getThemeInitScript,
} from "@agent-native/core/client";
import { IconSun, IconMoon } from "@tabler/icons-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkbenchShell } from "@/components/workbench-shell";
import { useNavigationState } from "@/hooks/use-navigation-state";
import type { LinksFunction } from "react-router";
import stylesheet from "./global.css?url";

configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "workbench",
  }),
});

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

const THEME_INIT_SCRIPT = getThemeInitScript();

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
        <meta name="theme-color" content="#0F172A" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Workbench" />
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

const TAB_ID = Math.random().toString(36).slice(2, 10);

function DbSyncSetup() {
  const qc = useQueryClient();
  useNavigationState();
  useDbSync({
    queryClient: qc,
    queryKeys: [
      "list-attention-queue",
      "list-prs",
      "inspect-pr",
      "list-runs",
      "inspect-run",
      "list-custom-tools",
      "list-workbench-repos",
      "list-workbench-review-templates",
      "list-workspace-connections",
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
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));

  return (
    <>
      <CommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen}>
        <CommandMenu.Group heading="Appearance">
          <ThemeToggleItem />
        </CommandMenu.Group>
      </CommandMenu>
      <AgentSidebar
        position="right"
        emptyStateText="Ask the agent to triage your queue, review a PR, or build a tool"
        suggestions={[
          "What needs my attention right now?",
          "Summarize the open PRs in my queue",
          "Build me a custom tool that lists flaky tests this week",
        ]}
      >
        <WorkbenchShell>
          <Outlet />
        </WorkbenchShell>
      </AgentSidebar>
      <Toaster richColors closeButton position="bottom-left" />
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
