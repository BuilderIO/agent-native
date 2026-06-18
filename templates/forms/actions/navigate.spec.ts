import { beforeEach, describe, expect, it, vi } from "vitest";

const appState = vi.hoisted(() => ({
  readAppState: vi.fn(),
  writeAppState: vi.fn(),
}));
const requestContext = vi.hoisted(() => ({
  runContext: undefined as { browserTabId?: string } | undefined,
}));

vi.mock("@agent-native/core/application-state", () => appState);
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestRunContext: () => requestContext.runContext,
}));

const { default: navigate } = await import("./navigate.js");

describe("navigate action", () => {
  beforeEach(() => {
    appState.readAppState.mockReset();
    appState.writeAppState.mockReset();
    requestContext.runContext = undefined;
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

  it("reads and writes navigation state for the requesting browser tab", async () => {
    requestContext.runContext = { browserTabId: "forms-tab-a" };
    appState.readAppState.mockImplementation(async (key) => {
      if (key === "navigation:forms-tab-a") {
        return { view: "form", formId: "form_tab" };
      }
      if (key === "navigation") {
        return { view: "form", formId: "form_global" };
      }
      return null;
    });

    await navigate.run({ view: "responses" });

    expect(appState.readAppState).toHaveBeenCalledWith(
      "navigation:forms-tab-a",
    );
    expect(appState.readAppState).not.toHaveBeenCalledWith("navigation");
    expect(appState.writeAppState).toHaveBeenCalledWith(
      "navigate:forms-tab-a",
      expect.objectContaining({
        view: "responses",
        formId: "form_tab",
      }),
    );
  });
});
