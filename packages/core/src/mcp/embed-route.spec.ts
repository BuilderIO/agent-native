import { describe, expect, it } from "vitest";
import { embedRoute } from "./embed-route.js";

describe("embedRoute", () => {
  it("returns matching action link and MCP App metadata for a path string", () => {
    const route = embedRoute({
      title: "Analysis",
      openLabel: "Open analysis",
      path: ({ args, result }) => `/analyses/${result.id}?from=${args.source}`,
    });

    expect(
      route.link({ args: { source: "mcp" }, result: { id: "a1" } }),
    ).toEqual({
      url: "/analyses/a1?from=mcp",
      label: "Open analysis",
    });
    expect(route.mcpApp.resource.title).toBe("Analysis");
    expect(route.mcpApp.resource.html).toBeTypeOf("function");
  });

  it("passes through custom ActionDeepLink values", () => {
    const route = embedRoute({
      title: "Draft",
      openLabel: "Open draft",
      path: () => ({
        url: "/_agent-native/open?view=draft&id=d1",
        label: "Review draft",
        view: "draft",
      }),
    });

    expect(route.link({ args: {}, result: {} })).toEqual({
      url: "/_agent-native/open?view=draft&id=d1",
      label: "Review draft",
      view: "draft",
    });
  });

  it("returns null links without hiding the MCP App resource", () => {
    const route = embedRoute({
      title: "Missing item",
      openLabel: "Open item",
      path: () => null,
    });

    expect(route.link({ args: {}, result: {} })).toBeNull();
    expect(route.mcpApp.resource.title).toBe("Missing item");
  });
});
