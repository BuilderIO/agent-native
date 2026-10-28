import {
  actionCallIntent,
  preparedCallNeedsApproval,
} from "@agent-native/core/action";
import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: (args: {
    app: string;
    view: string;
    params?: Record<string, string>;
  }) =>
    `/_agent-native/open?app=${args.app}&view=${args.view}&designId=${args.params?.designId ?? ""}`,
  getAppProductionUrl: () => "https://design.agent-native.com",
  getRequestContext: () => null,
  signShortLivedToken: () => "signed-token",
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(),
  registerShareableResource: vi.fn(),
}));

vi.mock("../server/db/index.js", () => ({
  schema: { designs: {} },
}));

vi.mock("../server/lib/coding-handoff.js", () => ({
  buildCodingHandoffPrompt: () => "Use this handoff",
  buildHandoffZipUrl: () =>
    "https://design.agent-native.com/api/design-handoff/design_123.zip?token=signed-token",
  buildRawHandoffUrl: () =>
    "https://design.agent-native.com/api/design-handoff/design_123?token=signed-token&format=json",
  normalizeHandoffFormat: (format?: string) => format ?? "markdown",
}));

vi.mock("../server/lib/design-snapshot.js", () => ({
  buildDesignSnapshot: vi.fn(),
}));

import action from "./export-coding-handoff.js";

describe("export-coding-handoff", () => {
  it("requires approval for outside calls while preserving ordinary in-app tools", async () => {
    const call = await actionCallIntent(action, { id: "design-test" });
    if (!call.valid) throw call.error;
    for (const [ctx, expected] of [
      [{ caller: "frontend" }, false],
      [{ caller: "tool" }, false],
      [{ caller: "http" }, true],
      [{ caller: "cli" }, true],
      [{ caller: "mcp-widget" }, true],
      [{ caller: "mcp-widget-write" }, true],
      [{ caller: "automation" }, true],
      [{ caller: "mcp" }, true],
      [{ caller: "webmcp" }, true],
      [{ caller: "a2a" }, true],
      [{ caller: "tool", networkProtocol: "mcp" }, true],
      [{ caller: "tool", networkProtocol: "a2a" }, true],
      [{ caller: "tool", networkProtocol: "provider-api" }, true],
      [
        {
          caller: "tool",
          automation: {
            triggerId: "trigger-test",
            triggerName: "Test automation",
            policyId: "policy-test",
          },
        },
        true,
      ],
    ] as const) {
      expect(
        await preparedCallNeedsApproval(action, call, ctx),
        JSON.stringify(ctx),
      ).toBe(expected);
    }
  });

  it("is available in the compact MCP Apps catalog", () => {
    expect(action.mcpApp?.compactCatalog).toBe(true);
    expect(action.mcpApp?.resource.title).toBe("Design agent handoff");
    expect(
      action.mcpApp?.resource.html({
        actionName: "export-coding-handoff",
        catalogMode: "app",
      }),
    ).toContain("--agent-native-shell-height: 680px");
  });

  it("returns an editor deep link for external hosts", () => {
    const link = action.link?.({
      args: {},
      result: { designId: "design_123" },
    });

    expect(link).toEqual({
      url: "/_agent-native/open?app=design&view=editor&designId=design_123",
      label: "Open design",
      view: "editor",
    });
  });
});
