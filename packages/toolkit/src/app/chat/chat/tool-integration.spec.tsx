import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  resolveAgentKitToolSource,
  resolveToolIntegration,
} from "./tool-integration.js";

describe("tool integration identity", () => {
  it.each(["slack", "gong", "sentry", "neon", "figma"])(
    "uses the catalog logo for %s across MCP and provider API calls",
    (provider) => {
      const source = resolveAgentKitToolSource({
        id: "tool-1",
        name: `mcp__org_example_${provider}__search`,
        status: "running",
      });
      expect(source?.id).toBe(provider);
      expect(renderToStaticMarkup(source!.icon)).toContain('src="data:image/');
      expect(
        resolveToolIntegration("provider-api-request", { provider })?.id,
      ).toBe(provider);
    },
  );

  it("keeps the invoked MCP server authoritative over tool names and arguments", () => {
    expect(
      resolveToolIntegration("mcp__zapier__send_slack_message", {
        provider: "slack",
      })?.id,
    ).toBe("zapier");
    expect(
      resolveToolIntegration("mcp__unknown__search_slack", {
        provider: "slack",
      }),
    ).toBeUndefined();
  });

  it("uses native integration action names without inferring from request text", () => {
    expect(resolveToolIntegration("search-slack")?.id).toBe("slack");
    expect(resolveToolIntegration("read-figma-file")?.id).toBe("figma");
    expect(
      resolveToolIntegration("tool-search", { query: "slack gong figma" }),
    ).toBeUndefined();
    expect(resolveToolIntegration("search-slacker")).toBeUndefined();
    expect(resolveToolIntegration("copy-slack-to-notion")).toBeUndefined();
  });

  it("keeps an unknown or incomplete provider unbranded", () => {
    for (const input of [
      undefined,
      { provider: "unknown" },
      { provider: null },
      '{"provider":',
    ]) {
      expect(
        resolveToolIntegration("provider-api-request", input),
      ).toBeUndefined();
    }
  });

  it("resolves complete streamed provider arguments without branding partial JSON", () => {
    expect(
      resolveToolIntegration("provider-api-request", '{"provider":"figma"}')
        ?.id,
    ).toBe("figma");
    expect(
      resolveToolIntegration("provider-api-request", '{"provider":"fig'),
    ).toBeUndefined();
  });
});
