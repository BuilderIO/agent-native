import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeAppState: vi.fn(),
  assertAccess: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
  registerShareableResource: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: (args: {
    app: string;
    view: string;
    params?: Record<string, string>;
    to?: string;
  }) =>
    `/_agent-native/open?app=${args.app}&view=${args.view}&designId=${args.params?.designId ?? ""}`,
}));

import action from "./present-design-variants.js";

describe("present-design-variants", () => {
  it("writes variants to application state and exposes MCP app metadata", async () => {
    const result = await action.run({
      designId: "design_123",
      prompt: "Pick a calmer picker direction",
      variants: [
        {
          id: "one-line-focus",
          label: "One-Line Focus",
          content: "<!DOCTYPE html><html><body>One</body></html>",
        },
        {
          id: "progressive-disclosure",
          label: "Progressive Disclosure",
          content: "<!DOCTYPE html><html><body>Two</body></html>",
        },
        {
          id: "quiet-studio",
          label: "Quiet Studio",
          content: "<!DOCTYPE html><html><body>Three</body></html>",
        },
      ],
    });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "design",
      "design_123",
      "editor",
    );
    expect(mocks.writeAppState).toHaveBeenCalledWith("design-variants", {
      designId: "design_123",
      prompt: "Pick a calmer picker direction",
      variants: expect.arrayContaining([
        expect.objectContaining({ id: "one-line-focus" }),
      ]),
    });
    expect(result).toMatchObject({
      designId: "design_123",
      count: 3,
      path: "/design/design_123",
      embed: true,
    });
    expect(action.mcpApp?.compactCatalog).toBe(true);
    expect(action.mcpApp?.resource.title).toBe("Design directions");
    expect(action.mcpApp?.resource.html()).toContain(
      "--agent-native-shell-height: 720px",
    );
  });

  it("requires exactly three variants for the MCP picker flow", () => {
    const base = {
      designId: "design_123",
      variants: [
        { id: "one", label: "One", content: "<html>One</html>" },
        { id: "two", label: "Two", content: "<html>Two</html>" },
        { id: "three", label: "Three", content: "<html>Three</html>" },
      ],
    };

    expect(action.schema.safeParse(base).success).toBe(true);
    expect(
      action.schema.safeParse({
        ...base,
        variants: base.variants.slice(0, 2),
      }).success,
    ).toBe(false);
  });

  it("returns an editor deep link for external hosts", async () => {
    const link = action.link?.({
      args: {},
      result: { designId: "design_123" },
    });

    expect(link).toEqual({
      url: "/_agent-native/open?app=design&view=editor&designId=design_123",
      label: "Open design directions",
      view: "editor",
    });
  });
});
