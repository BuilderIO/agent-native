import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const section = vi.hoisted(() => ({
  integrations: [] as { id: string }[],
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
vi.mock("@agent-native/toolkit/app/settings", () => ({
  SettingsGroup: ({ children }: { children: unknown }) => (
    <div>{children as never}</div>
  ),
}));
vi.mock("@agent-native/toolkit/app/integrations", () => ({
  McpIntegrationsSection: (props: { integrations: { id: string }[] }) => {
    section.integrations = props.integrations;
    return null;
  },
}));

import { AnalyticsConnectedAppsPage } from "./AnalyticsConnectedAppsPage";

it("offers only the providers this app is scoped to, not the whole framework catalogue", async () => {
  const { getDefaultMcpIntegrations } =
    await import("@agent-native/core/client/resources/mcp-integration-catalog");
  const { ANALYTICS_MCP_INTEGRATIONS } =
    await import("../../../shared/connected-apps");
  renderToStaticMarkup(<AnalyticsConnectedAppsPage />);
  const offered = section.integrations.map((integration) => integration.id);
  expect(offered.length).toBeGreaterThan(0);
  expect(offered.length).toBeLessThan(getDefaultMcpIntegrations().length);
  expect([...offered].sort()).toEqual(
    [...ANALYTICS_MCP_INTEGRATIONS.defaults.include].sort(),
  );
});
