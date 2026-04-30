import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { focusAgentChat, agentNativePath } from "@agent-native/core/client";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useDbSync } from "@agent-native/core";
import {
  ClientOnly,
  CommandMenu,
  DefaultSpinner,
  useCommandMenuShortcut,
} from "@agent-native/core/client";
import { IconSun, IconMoon } from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout as AppLayout } from "@/components/layout/Layout";
import type { LinksFunction } from "react-router";
import stylesheet from "./global.css?url";
import { configureTracking } from "@agent-native/core/client";
configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "agent-native-dispatch",
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
        <meta name="theme-color" content="#0f172a" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Dispatch" />
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

const TAB_ID = Math.random().toString(36).slice(2, 10);

function DbSyncSetup() {
  const qc = useQueryClient();
  useNavigationState();
  useDbSync({
    queryClient: qc,
    queryKeys: [
      "list-dispatch-overview",
      "list-destinations",
      "list-linked-identities",
      "list-dispatch-approvals",
      "list-dispatch-audit",
      "get-dispatch-settings",
      "list-connected-agents",
      "list-vault-secrets",
      "list-vault-grants",
      "list-vault-requests",
      "list-vault-audit",
      "list-workspace-resources",
      "list-workspace-resource-grants",
      "list-integrations-catalog",
    ],
    ignoreSource: TAB_ID,
  });
  useThreadDeepLink();
  return null;
}

/**
 * Reads ?thread=<id> from the URL on mount and opens that thread
 * in the agent sidebar via the chat-command application-state mechanism.
 */
function useThreadDeepLink() {
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current) return;
    const params = new URLSearchParams(window.location.search);
    const threadId = params.get("thread");
    if (!threadId) return;
    handled.current = true;

    // Write a chat-command to application-state so the sidebar opens this thread
    fetch(agentNativePath("/_agent-native/application-state/chat-command"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        command: "open-thread",
        threadId,
        timestamp: Date.now(),
      }),
    }).catch(() => {});

    // Open the sidebar
    focusAgentChat();

    // Clean the ?thread= param from the URL without a navigation
    params.delete("thread");
    const next =
      window.location.pathname +
      (params.toString() ? `?${params.toString()}` : "") +
      window.location.hash;
    window.history.replaceState({}, "", next);
  }, []);
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
  const [queryClient] = useState(() => new QueryClient());
  const [cmdkOpen, setCmdkOpen] = useState(false);
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
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
            <Toaster richColors position="bottom-left" />
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ClientOnly>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
