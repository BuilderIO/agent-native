import { beforeEach, describe, expect, it, vi } from "vitest";

const appState = vi.hoisted(() => ({
  readAppState: vi.fn(),
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => appState);

const { default: navigate } = await import("./navigate.js");

describe("navigate action", () => {
  beforeEach(() => {
    appState.readAppState.mockReset();
    appState.writeAppState.mockReset();
  });

  it("uses the current form when opening responses without an explicit formId", async () => {
    appState.readAppState.mockResolvedValue({
      view: "form",
      formId: "form_1",
    });

    await navigate.run({ view: "responses" });

    expect(appState.writeAppState).toHaveBeenCalledWith(
      "navigate",
      expect.objectContaining({
        view: "responses",
        formId: "form_1",
        _writeId: expect.any(String),
      }),
    );
  });

  it("rejects response navigation without a current or explicit form", async () => {
    appState.readAppState.mockResolvedValue({ view: "forms" });

    await expect(navigate.run({ view: "responses" })).rejects.toThrow(
      "responses navigation requires a formId.",
    );
    expect(appState.writeAppState).not.toHaveBeenCalled();
  });

  it("writes a unique form editor tab command", async () => {
    appState.readAppState.mockResolvedValue({ view: "forms" });

    await navigate.run({
      view: "form",
      formId: "CSVP7Bz6dC",
      tab: "edit",
    });

    expect(appState.writeAppState).toHaveBeenCalledWith(
      "navigate",
      expect.objectContaining({
        view: "form",
        formId: "CSVP7Bz6dC",
        tab: "edit",
        _writeId: expect.any(String),
      }),
    );
  });
});
