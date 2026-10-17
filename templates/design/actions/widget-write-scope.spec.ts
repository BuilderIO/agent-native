import { describe, expect, it } from "vitest";

import { assertDesignWidgetWriteScope } from "./widget-write-scope.js";

describe("Design widget file write scope", () => {
  const context = {
    caller: "mcp-widget-write" as const,
    mcpDirectoryWidgetWrite: {
      appId: "design",
      resourceIds: { designId: "design-123" },
      actionNames: ["create-file", "update-design", "update-file"],
    },
  };

  it("allows files within the bound design", () => {
    expect(() =>
      assertDesignWidgetWriteScope("design-123", context, {
        actionName: "update-file",
      }),
    ).not.toThrow();
  });

  it("rejects a file from a different design", () => {
    expect(() =>
      assertDesignWidgetWriteScope("design-elsewhere", context, {
        actionName: "update-file",
      }),
    ).toThrow("This widget write capability is scoped to a different design.");
  });

  it("rejects a grant for another app", () => {
    expect(() =>
      assertDesignWidgetWriteScope(
        "design-123",
        {
          ...context,
          mcpDirectoryWidgetWrite: {
            ...context.mcpDirectoryWidgetWrite,
            appId: "slides",
          },
        },
        { actionName: "update-file" },
      ),
    ).toThrow("This widget write capability is scoped to a different app.");
  });

  it("rejects a file action that is not in the widget grant", () => {
    expect(() =>
      assertDesignWidgetWriteScope(
        "design-123",
        {
          ...context,
          mcpDirectoryWidgetWrite: {
            ...context.mcpDirectoryWidgetWrite,
            actionNames: ["update-design"],
          },
        },
        { actionName: "create-file" },
      ),
    ).toThrow(
      "This widget write capability does not permit this Design action.",
    );
  });

  it("keeps ordinary editor requests on their existing authorization path", () => {
    expect(() =>
      assertDesignWidgetWriteScope("design-123", undefined, {
        actionName: "update-file",
      }),
    ).not.toThrow();
  });

  it("fails closed when the widget caller has no write grant", () => {
    expect(() =>
      assertDesignWidgetWriteScope(
        "design-123",
        { caller: "mcp-widget-write" },
        { actionName: "update-file" },
      ),
    ).toThrow(
      expect.objectContaining({
        errorCode: "mcp_widget_grant_required",
        statusCode: 403,
      }),
    );
  });
});
