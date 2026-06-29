import { afterEach, describe, expect, it, vi } from "vitest";

import { copyTextToClipboard } from "./clipboard";

describe("copyTextToClipboard", () => {
  afterEach(() => {
    delete (globalThis as { electronAPI?: unknown }).electronAPI;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("falls back when browser clipboard access is denied", async () => {
    const writeText = vi.fn(async () => {
      throw new DOMException("Write permission denied.", "NotAllowedError");
    });
    const execCommand = vi.fn(() => true);
    const textarea = {
      value: "",
      setAttribute: vi.fn(),
      style: {},
      select: vi.fn(),
      setSelectionRange: vi.fn(),
    };
    const body = {
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    };

    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("document", {
      body,
      createElement: vi.fn(() => textarea),
      execCommand,
    });

    await expect(
      copyTextToClipboard("https://calendar.test/book"),
    ).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://calendar.test/book");
    expect(body.appendChild).toHaveBeenCalledWith(textarea);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(body.removeChild).toHaveBeenCalledWith(textarea);
  });

  it("uses the desktop clipboard bridge when available", async () => {
    const writeText = vi.fn(async () => true);
    (globalThis as { electronAPI?: unknown }).electronAPI = {
      clipboard: { writeText },
    };

    await expect(copyTextToClipboard("desktop-copy")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("desktop-copy");
  });
});
