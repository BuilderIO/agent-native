import { describe, expect, it } from "vitest";

import { designEditorCommandFromSearchParams } from "./screen-command-utils";

describe("DesignEditor screen-focus URL command", () => {
  it("restores the canonical editorView query from a visual-edit URL", () => {
    expect(
      designEditorCommandFromSearchParams(
        "design-123",
        new URLSearchParams("editorView=overview"),
      ),
    ).toMatchObject({ designId: "design-123", editorView: "overview" });
  });

  it("keeps a focused screen on the overview canvas even for legacy single links", () => {
    expect(
      designEditorCommandFromSearchParams(
        "design-123",
        new URLSearchParams(
          "view=single&screen=screen-123&mode=interact&zoom=100",
        ),
      ),
    ).toMatchObject({
      designId: "design-123",
      editorView: "overview",
      screen: "screen-123",
    });
    expect(
      designEditorCommandFromSearchParams(
        "design-123",
        new URLSearchParams(
          "view=single&screen=screen-123&mode=interact&zoom=100",
        ),
      ),
    ).not.toHaveProperty("mode");
    expect(
      designEditorCommandFromSearchParams(
        "design-123",
        new URLSearchParams(
          "view=single&screen=screen-123&mode=interact&zoom=100",
        ),
      ),
    ).not.toHaveProperty("zoom");
  });

  it("does not let a host request enter Interact while focusing a screen", () => {
    expect(
      designEditorCommandFromSearchParams(
        "design-123",
        new URLSearchParams("view=single&screen=screen-123&mode=edit"),
      ),
    ).toMatchObject({ editorView: "overview", screen: "screen-123" });
    expect(
      designEditorCommandFromSearchParams(
        "design-123",
        new URLSearchParams("view=single&screen=screen-123&mode=edit"),
      ),
    ).not.toHaveProperty("mode");
  });

  it("does not honor Interact mode outside the focused view", () => {
    expect(
      designEditorCommandFromSearchParams(
        "design-123",
        new URLSearchParams("view=overview&mode=interact"),
      ),
    ).not.toHaveProperty("mode");
  });
});
