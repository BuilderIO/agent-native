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
  it("is available in the compact MCP Apps catalog", () => {
    expect(action.mcpApp?.compactCatalog).toBe(true);
    expect(action.mcpApp?.resource.title).toBe("Design agent handoff");
    expect(action.mcpApp?.resource.html()).toContain(
      "--agent-native-shell-height: 680px",
    );
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
