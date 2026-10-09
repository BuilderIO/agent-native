import { describe, expect, it } from "vitest";

import { assertDesignWidgetFileWriteScope } from "./widget-write-scope.js";

describe("Design widget file write scope", () => {
  const context = {
    caller: "mcp-widget-write" as const,
    mcpDirectoryWidgetWrite: {
      appId: "design",
      resourceIds: { designId: "design-123" },
      actionNames: ["update-design"],
    },
  };

  it("allows files within the bound design", () => {
    expect(() =>
      assertDesignWidgetFileWriteScope("design-123", context),
    ).not.toThrow();
  });

  it("rejects a file from a different design", () => {
    expect(() =>
      assertDesignWidgetFileWriteScope("design-elsewhere", context),
    ).toThrow("This widget write capability is scoped to a different design.");
  });

  it("rejects a grant for another app", () => {
    expect(() =>
      assertDesignWidgetFileWriteScope("design-123", {
        ...context,
        mcpDirectoryWidgetWrite: {
          ...context.mcpDirectoryWidgetWrite,
          appId: "slides",
        },
      }),
    ).toThrow("This widget write capability is scoped to a different design.");
  });

  it("keeps ordinary editor requests on their existing authorization path", () => {
    expect(() =>
      assertDesignWidgetFileWriteScope("design-123", undefined),
    ).not.toThrow();
  });
});
