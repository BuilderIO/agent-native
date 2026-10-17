import { describe, expect, it } from "vitest";

import { DESIGN_EDITOR_TOOLS } from "@/pages/design-editor/tool-state";

import {
  designEditorCommandKeysForTab,
  designSelectionCleanupKeysForTab,
  designSelectionStateKeysForTab,
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
      "/design/design_123?editorView=single&mode=interact&screen=empty-state.html&zoom=100",
    );
    expect(editorCommandFromNavigate(command, path!)).toMatchObject({
      designId: "design_123",
      editorView: "single",
      mode: "interact",
      filename: "empty-state.html",
      zoom: 100,
      path,
    });
  });

  it("round-trips every tool the editor knows into the URL", () => {
    for (const tool of DESIGN_EDITOR_TOOLS) {
      const path = editorPathFromCommand({
        view: "editor",
        designId: "design_123",
        tool,
      });
      expect(path, tool).toBe(`/design/design_123?tool=${tool}`);
    }
  });

  it("writes a stale tool=agent as Move into the URL and the editor command", () => {
    const command = { view: "editor", designId: "design_123", tool: "agent" };

    const path = editorPathFromCommand(command);

    expect(path).toBe("/design/design_123?tool=move");
    expect(editorCommandFromNavigate(command, path!)).toMatchObject({
      designId: "design_123",
      tool: "move",
    });
  });

  it("drops a tool the editor does not know instead of writing it into the URL", () => {
    expect(
      editorPathFromCommand({
        view: "editor",
        designId: "design_123",
        tool: "lasso",
      }),
    ).toBe("/design/design_123");
  });

  it("round-trips the active design tool through editor navigation", () => {
    const command = {
      view: "editor",
      designId: "design_123",
      editorView: "overview" as const,
      tool: "pen",
    };

    const path = editorPathFromCommand(command);

    expect(path).toBe("/design/design_123?editorView=overview&tool=pen");
    expect(editorCommandFromNavigate(command, path!)).toMatchObject({
      designId: "design_123",
      editorView: "overview",
      tool: "pen",
      path,
    });
  });

  it("carries the Interact device and theme into the editor command without putting them in the URL", () => {
    const command = {
      view: "editor",
      designId: "design_123",
      editorView: "single" as const,
      screen: "pricing.html",
      interactDevice: "iPhone 17",
      interactTheme: "dark" as const,
    };

    const path = editorPathFromCommand(command);

    expect(path).toBe(
      "/design/design_123?editorView=single&mode=interact&screen=pricing.html&zoom=100",
    );
    expect(editorCommandFromNavigate(command, path!)).toMatchObject({
      designId: "design_123",
      interactDevice: "iPhone 17",
      interactTheme: "dark",
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
      "/design/design_123?editorView=overview&screen=screen-abc&selection=node-def",
    );
    expect(editorCommandFromNavigate(command, path!)).toMatchObject({
      designId: "design_123",
      editorView: "overview",
      screen: "screen-abc",
      selection: "node-def",
      path,
    });
  });

  it("ignores the Motion inspector tab: the Motion dock owns that surface", () => {
    const command = {
      view: "editor",
      designId: "design_123",
      inspectorTab: "motion",
    };

    const path = editorPathFromCommand(command);

    expect(path).toBe("/design/design_123");
    expect(editorCommandFromNavigate(command, path!)).not.toMatchObject({
      inspectorTab: expect.anything(),
      leftPanel: expect.anything(),
    });
  });

  it("round-trips an enabled left rail panel through editor navigation", () => {
    const command = {
      view: "editor",
      designId: "design_123",
      leftPanel: "import" as const,
    };

    const path = editorPathFromCommand(command);

    expect(path).toBe("/design/design_123?panel=import");
    expect(editorCommandFromNavigate(command, path!)).toMatchObject({
      designId: "design_123",
      leftPanel: "import",
      path,
    });
  });

  it("round-trips the Threads left rail panel through editor navigation", () => {
    const command = {
      view: "editor",
      designId: "design_123",
      leftPanel: "threads" as const,
    };

    const path = editorPathFromCommand(command);

    expect(path).toBe("/design/design_123?panel=threads");
    expect(editorCommandFromNavigate(command, path!)).toMatchObject({
      designId: "design_123",
      leftPanel: "threads",
      path,
    });
  });

  it("drops gated left rail panels from editor navigation", () => {
    const command = {
      view: "editor",
      designId: "design_123",
      leftPanel: "assets" as const,
    };

    const path = editorPathFromCommand(command);

    expect(path).toBe("/design/design_123");
    expect(editorCommandFromNavigate(command, path!)).not.toMatchObject({
      leftPanel: expect.anything(),
    });
  });

  it("drops the legacy extensions inspector alias when Tools is gated", () => {
    const command = {
      view: "editor",
      designId: "design_123",
      inspectorTab: "extensions" as const,
    };

    const path = editorPathFromCommand(command);

    expect(path).toBe("/design/design_123");
    expect(editorCommandFromNavigate(command, path!)).not.toMatchObject({
      inspectorTab: expect.anything(),
      leftPanel: expect.anything(),
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

    expect(path).toBe("/design/design_123?editorView=overview");
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

  it("clears design selection for both the active browser tab and global fallback", () => {
    expect(designSelectionStateKeysForTab("tab-123")).toEqual([
      "design-selection:tab-123",
      "design-selection",
    ]);
    expect(designSelectionStateKeysForTab()).toEqual(["design-selection"]);
  });

  it("limits route cleanup to the active tab so another editor keeps the global fallback", () => {
    expect(designSelectionCleanupKeysForTab("tab-123")).toEqual([
      "design-selection:tab-123",
    ]);
    expect(designSelectionCleanupKeysForTab()).toEqual(["design-selection"]);
  });
});
