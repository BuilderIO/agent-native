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
    });

    expect(mocks.writeAppState).toHaveBeenCalledWith("navigate", {
      view: "editor",
      designId: "design_123",
      editorView: "overview",
      filename: "checkout.html",
      zoom: 80,
    });
    expect(result).toContain("overview view");
    expect(result).toContain("checkout.html");
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
});
