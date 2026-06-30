import { describe, expect, it } from "vitest";

import {
  designEditorCommandKeysForTab,
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

  it("round-trips the active design tool through editor navigation", () => {
    const command = {
      view: "editor",
      designId: "design_123",
      editorView: "overview" as const,
      tool: "pen",
    };

    const path = editorPathFromCommand(command);

    expect(path).toBe("/design/design_123?view=overview&tool=pen");
    expect(editorCommandFromNavigate(command, path!)).toMatchObject({
      designId: "design_123",
      editorView: "overview",
      tool: "pen",
      path,
    });
  });

  it("round-trips selected layer state through editor navigation", () => {
    const command = {
      view: "editor",
      designId: "design_123",
      editorView: "overview" as const,
      screen: "screen-abc",
      selection: "node-def",
    };

    const path = editorPathFromCommand(command);

    expect(path).toBe(
      "/design/design_123?view=overview&screen=screen-abc&selection=node-def",
    );
    expect(editorCommandFromNavigate(command, path!)).toMatchObject({
      designId: "design_123",
      editorView: "overview",
      screen: "screen-abc",
      selection: "node-def",
      path,
    });
  });

  it("round-trips the active left rail panel through editor navigation", () => {
    const command = {
      view: "editor",
      designId: "design_123",
      leftPanel: "tokens" as const,
    };

    const path = editorPathFromCommand(command);

    expect(path).toBe("/design/design_123?panel=tokens");
    expect(editorCommandFromNavigate(command, path!)).toMatchObject({
      designId: "design_123",
      leftPanel: "tokens",
      path,
    });
  });

  it("ignores unknown design tools in navigation commands", () => {
    const command = {
      view: "editor",
      designId: "design_123",
      editorView: "overview" as const,
      tool: "lasso",
    };

    const path = editorPathFromCommand(command);

    expect(path).toBe("/design/design_123?view=overview");
    expect(editorCommandFromNavigate(command, path!)).not.toMatchObject({
      tool: expect.anything(),
    });
  });

  it("keeps editor commands scoped to the active browser tab", () => {
    expect(designEditorCommandKeysForTab("tab-123")).toEqual([
      "design-editor-command:tab-123",
    ]);
    expect(designEditorCommandKeysForTab()).toEqual(["design-editor-command"]);
  });
});
