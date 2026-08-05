import { afterEach, describe, expect, it, vi } from "vitest";

import { writeClipboardText } from "./clipboard.js";

describe("writeClipboardText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the Agent Native Desktop webview clipboard bridge", async () => {
    const writeText = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("agentNativeDesktop", {
      clipboard: { writeText },
    });

    await expect(writeClipboardText("copy me")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("copy me");
  });

  it("falls back when a desktop clipboard bridge rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    const browserWriteText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("agentNativeDesktop", {
      clipboard: { writeText },
    });
    vi.stubGlobal("navigator", {
      clipboard: { writeText: browserWriteText },
    });

    await expect(writeClipboardText("copy me")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("copy me");
    expect(browserWriteText).toHaveBeenCalledWith("copy me");
  });

  it("writes a rich text/html flavor when html is provided", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    const items: unknown[] = [];
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(data: unknown) {
          items.push(data);
        }
      },
    );
    vi.stubGlobal("navigator", { clipboard: { write, writeText } });

    await expect(
      writeClipboardText("**hi**", { html: "<strong>hi</strong>" }),
    ).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    expect(Object.keys(items[0] as Record<string, unknown>)).toEqual([
      "text/plain",
      "text/html",
    ]);
  });

  it("falls back to plain text when ClipboardItem is unavailable", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { write, writeText } });

    await expect(
      writeClipboardText("**hi**", { html: "<strong>hi</strong>" }),
    ).resolves.toBe(true);
    expect(write).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith("**hi**");
  });

  it("falls back to plain text when the rich write rejects", async () => {
    const write = vi.fn().mockRejectedValue(new Error("denied"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor() {}
      },
    );
    vi.stubGlobal("navigator", { clipboard: { write, writeText } });

    await expect(
      writeClipboardText("**hi**", { html: "<strong>hi</strong>" }),
    ).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("**hi**");
  });
});
