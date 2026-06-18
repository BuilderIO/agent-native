import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useNavigate,
} from "react-router";
import { useCallback, useState } from "react";
import { useNavigationState } from "@/hooks/use-navigation-state";
import { useQueryClient } from "@tanstack/react-query";
import { useDbSync } from "@agent-native/core";
import {
  AppProviders,
  CommandMenu,
  appPath,
  createAgentNativeQueryClient,
  getThemeInitScript,
  navigateWithAgentChatViewTransition,
  useCommandMenuShortcut,
} from "@agent-native/core/client";
import { IconSun, IconMoon } from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { Layout as AppLayout } from "@/components/layout/Layout";
import { TAB_ID } from "@/lib/tab-id";
import { APP_TITLE } from "@/lib/app-config";
import { markPlanChatHomeHandoff } from "@/lib/chat-home-handoff";
// Side effect: register Plan's native chat renderers so visual answers render
// their diagram/wireframe/api-spec blocks inline in the agent chat.
import "@/lib/register-chat-renderers";
import type { LinksFunction } from "react-router";
import stylesheet from "./global.css?url";
import { configureTracking } from "@agent-native/core/client";
configureTracking({
  getDefaultProps: (_name, properties) => ({
    ...properties,
    app: "plan",
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
        <meta name="theme-color" content="#71717A" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content={APP_TITLE} />
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
  useDbSync({
    queryClient: qc,
    ignoreSource: TAB_ID,
  });
  return null;
}

function AppContent() {
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  useCommandMenuShortcut(useCallback(() => setCmdkOpen(true), []));
  const go = useCallback(
    (path: string) => {
      if (path !== "/") markPlanChatHomeHandoff();
      navigateWithAgentChatViewTransition(navigate, path);
      setCmdkOpen(false);
    },
    [navigate],
  );
  return (
    <>
      <CommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen}>
        <CommandMenu.Group heading="Actions">
          <CommandMenu.Item onSelect={() => go("/")}>Ask Plan</CommandMenu.Item>
          <CommandMenu.Item onSelect={() => go("/plans")}>
            Open plans
          </CommandMenu.Item>
          <CommandMenu.Item onSelect={() => go("/recaps")}>
            Open recaps
          </CommandMenu.Item>
        </CommandMenu.Group>
        <CommandMenu.Group heading="Appearance">
          <CommandMenu.Item
            onSelect={() => setTheme(isDark ? "light" : "dark")}
            keywords={["theme", "dark", "light", "mode"]}
          >
            {isDark ? <IconSun size={16} /> : <IconMoon size={16} />}
            Toggle {isDark ? "light" : "dark"} mode
          </CommandMenu.Item>
        </CommandMenu.Group>
      </CommandMenu>
      <AppLayout>
        <Outlet />
      </AppLayout>
    </>
  );
}

export default function Root() {
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  return (
    // Pass the plan-specific styled Toaster via `toaster` so only one sonner
    // instance renders (avoids the duplicate that would appear if AppProviders'
    // built-in Toaster AND a children-rendered Toaster both mounted).
    <AppProviders
      queryClient={queryClient}
      toaster={<Toaster richColors position="bottom-left" />}
    >
      <DbSyncSetup />
      <AppContent />
    </AppProviders>
  );
}

export { ErrorBoundary } from "@agent-native/core/client";
