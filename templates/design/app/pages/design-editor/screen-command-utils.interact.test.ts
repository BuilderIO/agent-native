import { describe, expect, it } from "vitest";

import { designEditorCommandFromSearchParams } from "./screen-command-utils";

describe("DesignEditor Interact URL command", () => {
  it("restores explicit Interact mode for a focused screen", () => {
    expect(
      designEditorCommandFromSearchParams(
        "design-123",
        new URLSearchParams(
          "view=single&screen=screen-123&mode=interact&zoom=100",
        ),
      ),
    ).toMatchObject({
      designId: "design-123",
      editorView: "single",
      screen: "screen-123",
      mode: "interact",
      zoom: 100,
    });
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
