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
});
