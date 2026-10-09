import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  writeAppStateForCurrentTab: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppStateForCurrentTab: mocks.writeAppStateForCurrentTab,
}));

import { DESIGN_EDITOR_TOOLS } from "../app/pages/design-editor/tool-state";
import action from "./navigate.js";

describe("navigate", () => {
  beforeEach(() => {
    mocks.writeAppStateForCurrentTab.mockReset();
  });

  it("writes editor overview and focused screen commands", async () => {
    const result = await action.run({
      view: "editor",
      designId: "design_123",
      editorView: "overview",
      filename: "checkout.html",
      zoom: 80,
      tool: "pen",
    });

    expect(mocks.writeAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "editor",
      designId: "design_123",
      editorView: "overview",
      filename: "checkout.html",
      zoom: 80,
      tool: "pen",
    });
    expect(result).toContain("overview view");
    expect(result).toContain("checkout.html");
    expect(result).toContain("pen tool");
  });

  it("accepts viewMode as an alias for editorView", async () => {
    await action.run({
      view: "editor",
      designId: "design_123",
      viewMode: "single",
      screen: "settings",
    });

    expect(mocks.writeAppStateForCurrentTab).toHaveBeenCalledWith(
      "navigate",
      expect.objectContaining({
        editorView: "single",
        screen: "settings",
      }),
    );
  });

  it("rejects design views without a design id", () => {
    expect(action.schema.safeParse({ view: "editor" }).success).toBe(false);
    expect(action.schema.safeParse({ view: "present" }).success).toBe(false);
    expect(action.schema.safeParse({ view: "design-systems" }).success).toBe(
      true,
    );
  });

  it("rejects single editor view without a screen target", () => {
    expect(
      action.schema.safeParse({
        view: "editor",
        designId: "design_123",
        editorView: "single",
      }).success,
    ).toBe(false);

    expect(
      action.schema.safeParse({
        view: "editor",
        designId: "design_123",
        editorView: "single",
        fileId: "file_123",
      }).success,
    ).toBe(true);
  });

  it("accepts every tool the editor knows, including agent, and nothing else", () => {
    const withTool = (tool: string) =>
      action.schema.safeParse({
        view: "editor",
        designId: "design_123",
        tool,
      }).success;

    for (const tool of DESIGN_EDITOR_TOOLS) {
      expect(withTool(tool), tool).toBe(true);
    }
    expect(DESIGN_EDITOR_TOOLS.has("agent")).toBe(true);
    expect(withTool("lasso")).toBe(false);
  });

  it("carries the agent tool into the one-shot navigation command", async () => {
    await action.run({ view: "editor", designId: "design_123", tool: "agent" });

    expect(mocks.writeAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "editor",
      designId: "design_123",
      tool: "agent",
    });
  });
});
