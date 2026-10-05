// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readRememberedEditorMode,
  rememberEditorMode,
} from "./editor-mode-memory";

describe("the Page's remembered editing mode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it("reopens a Page in the mode this tab left it in", () => {
    expect(readRememberedEditorMode("page-a")).toBe("editing");

    rememberEditorMode("page-a", "suggesting");
    expect(readRememberedEditorMode("page-a")).toBe("suggesting");
    expect(readRememberedEditorMode("page-b")).toBe("editing");

    rememberEditorMode("page-a", "editing");
    expect(readRememberedEditorMode("page-a")).toBe("editing");
  });

  it("reports unreadable storage instead of claiming Edit mode", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(readRememberedEditorMode("page-a")).toBe("unavailable");
  });
});
