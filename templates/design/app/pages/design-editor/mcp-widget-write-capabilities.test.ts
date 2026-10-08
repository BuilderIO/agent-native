import { describe, expect, it } from "vitest";

import { applyMcpDirectoryWidgetReadOnlyPolicy } from "./mcp-widget-write-capabilities";

describe("MCP directory widget write capabilities", () => {
  const editableDesignCapabilities = {
    canEditDesign: true,
    canEditLiveScreens: true,
    publicVisualEdit: true,
    canCommentDesign: true,
    canRenderAuthenticatedShare: true,
  };

  it("removes every write affordance from a read-only widget session", () => {
    expect(
      applyMcpDirectoryWidgetReadOnlyPolicy(editableDesignCapabilities, true),
    ).toEqual({
      canEditDesign: false,
      canEditLiveScreens: false,
      publicVisualEdit: false,
      canCommentDesign: false,
      canRenderAuthenticatedShare: false,
    });
  });

  it("keeps the resolved permissions for normal editor sessions", () => {
    expect(
      applyMcpDirectoryWidgetReadOnlyPolicy(editableDesignCapabilities, false),
    ).toBe(editableDesignCapabilities);
  });
});
