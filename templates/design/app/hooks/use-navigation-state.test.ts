import { describe, expect, it } from "vitest";

import {
  editorCommandFromNavigate,
  editorPathFromCommand,
} from "./use-navigation-state";

describe("design navigation state", () => {
  it("defaults focused screen navigation to a readable zoom", () => {
    const command = {
      view: "editor",
      designId: "design_123",
      editorView: "single" as const,
      filename: "empty-state.html",
    };

    const path = editorPathFromCommand(command);

    expect(path).toBe(
      "/design/design_123?view=single&screen=empty-state.html&zoom=100",
    );
    expect(editorCommandFromNavigate(command, path!)).toMatchObject({
      designId: "design_123",
      editorView: "single",
      filename: "empty-state.html",
      zoom: 100,
      path,
    });
  });
});
