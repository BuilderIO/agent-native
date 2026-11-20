import {
  createAgentNativeQueryClient,
  getBrowserTabId,
  useDbSync,
} from "@agent-native/core/client/hooks";
import { AgentSidebar } from "@agent-native/toolkit/app/chat";
import { AppProviders } from "@agent-native/toolkit/app/providers";
import { ToolkitProvider } from "@agent-native/toolkit/provider";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import { Toaster } from "@/components/ui/sonner";

import { designSystem } from "./design-system";
import { useNavigationState } from "./hooks/use-navigation-state";
import { i18nCatalog } from "./i18n";
import messages from "./i18n/en-US";

import stylesheet from "./global.css?url";
export const links = () => [{ rel: "stylesheet", href: stylesheet }];
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{"Journeys"}</title>
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
function NavigationSync() {
  useNavigationState();
  const queryClient = useQueryClient();
  useDbSync({
    queryClient,
    ignoreSource: getBrowserTabId(),
    realtime: { reason: "the agent can edit journeys, emails and audiences while they are open" },
    interval: 2000,
    fallbackInterval: 2000,
  });
  return null;
}
export default function Root() {
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  return (
    <ToolkitProvider designSystem={designSystem}>
      <AppProviders
        queryClient={queryClient}
        i18n={{ catalog: i18nCatalog }}
        defaultTheme="light"
        toaster={<Toaster richColors position="bottom-center" />}
      >
        <NavigationSync />
        <AgentSidebar
          browserTabId={getBrowserTabId()}
          position="right"
          openStorageKey="journeys.agentOpen"
          composerPlaceholder={messages.journeys.askTheAgent}
        >
          <Outlet />
        </AgentSidebar>
      </AppProviders>
    </ToolkitProvider>
  );
}
export { ErrorBoundary } from "@agent-native/toolkit/app/shared/ErrorBoundary";
