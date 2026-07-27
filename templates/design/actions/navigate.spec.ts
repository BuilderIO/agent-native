import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));

import action from "./navigate.js";

describe("navigate", () => {
  beforeEach(() => {
    mocks.writeAppState.mockReset();
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

    expect(mocks.writeAppState).toHaveBeenCalledWith("navigate", {
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

    expect(mocks.writeAppState).toHaveBeenCalledWith(
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
});
