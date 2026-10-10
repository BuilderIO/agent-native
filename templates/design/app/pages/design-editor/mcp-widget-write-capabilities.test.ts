import { describe, expect, it } from "vitest";

import {
  applyMcpDirectoryWidgetReadOnlyPolicy,
  applyMcpDirectoryWidgetWritePolicy,
  shouldRenderDesignShareControl,
  shouldShowFullDesignProjectMenu,
} from "./mcp-widget-write-capabilities";

describe("MCP directory widget write capabilities", () => {
  it("keeps widget project menus limited to the allowlisted title rename", () => {
    expect(shouldShowFullDesignProjectMenu(true)).toBe(false);
    expect(shouldShowFullDesignProjectMenu(false)).toBe(true);
  });

  const editableDesignCapabilities = {
    canEditDesign: true,
    canEditLiveScreens: true,
    publicVisualEdit: true,
    canCommentDesign: true,
    canRenderAuthenticatedShare: true,
  };

  it("renders widget sharing only for a share-capable authenticated owner/admin", () => {
    expect(
      shouldRenderDesignShareControl({
        widgetEmbed: true,
        canShareDesign: true,
        canRenderAuthenticatedShare: true,
      }),
    ).toBe(true);
    expect(
      shouldRenderDesignShareControl({
        widgetEmbed: true,
        canShareDesign: false,
        canRenderAuthenticatedShare: true,
      }),
    ).toBe(false);
    expect(
      shouldRenderDesignShareControl({
        widgetEmbed: true,
        canShareDesign: true,
        canRenderAuthenticatedShare: false,
      }),
    ).toBe(false);
  });

  it("preserves the existing share visibility for non-widget editors", () => {
    expect(
      shouldRenderDesignShareControl({
        widgetEmbed: false,
        canShareDesign: false,
        canRenderAuthenticatedShare: true,
      }),
    ).toBe(true);
  });

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

  it.each(["viewer", "commenter"] as const)(
    "does not elevate a %s to design editor with a widget write grant",
    (role) => {
      const roleCapabilities = {
        canEditDesign: false,
        canEditLiveScreens: role === "viewer" || role === "commenter",
        publicVisualEdit: false,
        canCommentDesign: role === "commenter",
        canRenderAuthenticatedShare: true,
      };

      expect(
        applyMcpDirectoryWidgetWritePolicy(roleCapabilities, true, true),
      ).toEqual(roleCapabilities);
    },
  );

  it.each(["editor", "owner"] as const)(
    "preserves %s edit access when the widget has a write grant",
    () => {
      expect(
        applyMcpDirectoryWidgetWritePolicy(
          editableDesignCapabilities,
          true,
          true,
        ),
      ).toEqual(editableDesignCapabilities);
    },
  );

  it("does not grant edit access to a directory widget without a write ticket", () => {
    expect(
      applyMcpDirectoryWidgetWritePolicy(
        editableDesignCapabilities,
        true,
        false,
      ),
    ).toMatchObject({ canEditDesign: false });
  });

  it("keeps ordinary editor permissions unchanged outside directory widgets", () => {
    expect(
      applyMcpDirectoryWidgetWritePolicy(
        editableDesignCapabilities,
        false,
        false,
      ),
    ).toBe(editableDesignCapabilities);
  });

  it("still blocks every write when a read-only widget policy applies", () => {
    const writeGrant = applyMcpDirectoryWidgetWritePolicy(
      editableDesignCapabilities,
      true,
      false,
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
