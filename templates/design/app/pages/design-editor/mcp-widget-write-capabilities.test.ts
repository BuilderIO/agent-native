import { describe, expect, it } from "vitest";

import {
  applyMcpDirectoryWidgetReadOnlyPolicy,
  applyMcpDirectoryWidgetWritePolicy,
} from "./mcp-widget-write-capabilities";

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

  it("enables Design editing only for an explicitly writable widget", () => {
    const viewerCapabilities = {
      canEditDesign: false,
      canEditLiveScreens: false,
      publicVisualEdit: false,
      canCommentDesign: false,
      canRenderAuthenticatedShare: false,
    };

    expect(
      applyMcpDirectoryWidgetWritePolicy(viewerCapabilities, true),
    ).toEqual({ ...viewerCapabilities, canEditDesign: true });
    expect(applyMcpDirectoryWidgetWritePolicy(viewerCapabilities, false)).toBe(
      viewerCapabilities,
    );
  });

  it("still blocks every write when a read-only widget policy applies", () => {
    const writeGrant = applyMcpDirectoryWidgetWritePolicy(
      {
        canEditDesign: false,
        canEditLiveScreens: false,
        publicVisualEdit: false,
        canCommentDesign: false,
        canRenderAuthenticatedShare: false,
      },
      true,
    );

    expect(applyMcpDirectoryWidgetReadOnlyPolicy(writeGrant, true)).toEqual({
      canEditDesign: false,
      canEditLiveScreens: false,
      publicVisualEdit: false,
      canCommentDesign: false,
      canRenderAuthenticatedShare: false,
    });
  });
});
