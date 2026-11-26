import { describe, expect, it } from "vitest";

import {
  allowsVisualEditCapabilityResource,
  VISUAL_EDIT_CAPABILITY_ACTIONS,
  visualEditCapabilityDesignId,
} from "./visual-edit-capability.js";

const CAPABILITY = "capability:visual-edit:design:board_1";

describe("visual-edit capability allowlist", () => {
  it("is exactly the board and handoff actions", () => {
    expect(Object.keys(VISUAL_EDIT_CAPABILITY_ACTIONS).sort()).toEqual([
      "acknowledge-visual-edit-pending",
      "add-breakpoint",
      "add-localhost-screens",
      "apply-tweaks",
      "clear-edits",
      "clear-localhost-write-consent-request",
      "create-file",
      "get-design",
      "get-design-snapshot",
      "get-localhost-write-consent-request",
      "get-visual-edit-pending",
      "get-visual-edit-snapshot",
      "list-design-source-capabilities",
      "list-design-states",
      "list-files",
      "list-local-files",
      "list-localhost-connections",
      "migrate-board-objects-to-file",
      "publish-visual-edit-pending",
      "read-local-file",
      "refresh-localhost-preview-token",
      "remove-breakpoint",
      "rename-screen",
      "request-localhost-write-consent",
      "update-breakpoint",
      "update-design",
      "update-file",
      "update-screen-source",
    ]);
  });

  it.each([
    "share-resource",
    "unshare-resource",
    "set-resource-visibility",
    "create-design",
    "delete-design",
    "duplicate-design",
    "delete-file",
    "generate-design",
    "claim-visual-edit-board",
    "open-visual-edit",
    "update-visual-edit-collaboration",
  ])("denies %s", (action) => {
    expect(
      allowsVisualEditCapabilityResource(action, CAPABILITY, {
        designId: "board_1",
        id: "board_1",
      }),
    ).toBe(false);
  });

  it("allows only the capability's own design", () => {
    expect(
      allowsVisualEditCapabilityResource("clear-edits", CAPABILITY, {
        designId: "board_1",
      }),
    ).toBe(true);
    expect(
      allowsVisualEditCapabilityResource("clear-edits", CAPABILITY, {
        designId: "board_2",
      }),
    ).toBe(false);
    expect(
      allowsVisualEditCapabilityResource("create-file", CAPABILITY, {
        designId: "board_1",
      }),
    ).toBe(true);
    expect(
      allowsVisualEditCapabilityResource("create-file", CAPABILITY, {
        designId: "board_2",
      }),
    ).toBe(false);
    expect(
      allowsVisualEditCapabilityResource("create-file", CAPABILITY, {}),
    ).toBe(false);
    expect(
      allowsVisualEditCapabilityResource("update-design", CAPABILITY, {
        id: "board_1",
      }),
    ).toBe(true);
    expect(
      allowsVisualEditCapabilityResource("update-design", CAPABILITY, {
        id: "board_2",
        designId: "board_1",
      }),
    ).toBe(false);
  });

  it("requires a file id for file-scoped actions", () => {
    expect(
      allowsVisualEditCapabilityResource("update-file", CAPABILITY, {
        id: "file_1",
      }),
    ).toBe(true);
    expect(
      allowsVisualEditCapabilityResource("update-file", CAPABILITY, {
        designId: "board_1",
      }),
    ).toBe(false);
  });

  it("fails closed on a malformed capability", () => {
    for (const capability of [
      "capability:visual-edit:design:",
      "capability:visual-edit:design:%E0%A4%A",
      "capability:visual-edit:other:board_1",
      "capability:visual-edit:design:board_1:extra",
    ]) {
      expect(visualEditCapabilityDesignId(capability)).toBeNull();
      expect(
        allowsVisualEditCapabilityResource("list-files", capability, {
          designId: "board_1",
        }),
      ).toBe(false);
    }
  });

  it("does not restrict requests without a visual-edit capability", () => {
    expect(
      allowsVisualEditCapabilityResource("share-resource", undefined, {}),
    ).toBe(true);
  });

  it("decodes the scoped design id", () => {
    expect(
      allowsVisualEditCapabilityResource(
        "list-files",
        "capability:visual-edit:design:design%2F1",
        { designId: "design/1" },
      ),
    ).toBe(true);
  });
});
