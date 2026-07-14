import type { ComponentType } from "react";

export type AgentPageProps = {
  appName?: string;
};

type AgentClientModule = {
  AgentChatSurface: ComponentType<{
    mode?: "panel" | "page";
    className?: string;
  }>;
  AgentTabsPage?: ComponentType<AgentPageProps>;
};

const legacyAgentPages = new WeakMap<
  AgentClientModule,
  ComponentType<AgentPageProps>
>();

/**
 * Keep the chat scaffold runnable when its template and core package are
 * briefly out of sync during a release. Older core versions do not export
 * AgentTabsPage, but they do expose the page-level chat surface.
 */
export function resolveAgentPageComponent(
  client: AgentClientModule,
): ComponentType<AgentPageProps> {
  if (typeof client.AgentTabsPage === "function") {
    return client.AgentTabsPage;
  }

  const existing = legacyAgentPages.get(client);
  if (existing) return existing;

  const legacyAgentPage = function LegacyAgentPage() {
    return <client.AgentChatSurface mode="page" className="h-full" />;
  };
  legacyAgentPages.set(client, legacyAgentPage);
  return legacyAgentPage;
}
