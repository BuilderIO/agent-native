import { describe, expect, it, vi } from "vitest";

import {
  sendWithInjectionFallback,
  shouldFollowOverlay,
} from "./overlay-follow";

describe("overlay follow runtime", () => {
  it("uses the declarative content script when message delivery succeeds", async () => {
    const sendMessage = vi.fn().mockResolvedValue(true);
    const injectContentScript = vi.fn().mockResolvedValue(true);

    await expect(
      sendWithInjectionFallback(sendMessage, injectContentScript),
    ).resolves.toBe(true);
    expect(sendMessage).toHaveBeenCalledOnce();
    expect(injectContentScript).not.toHaveBeenCalled();
  });

  it("injects once and retries when the current tab has no receiver", async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const injectContentScript = vi.fn().mockResolvedValue(true);

    await expect(
      sendWithInjectionFallback(sendMessage, injectContentScript),
    ).resolves.toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(injectContentScript).toHaveBeenCalledOnce();
  });

  it("follows an active countdown while recording creation is still arming", () => {
    expect(shouldFollowOverlay("countdown", false, true)).toBe(true);
    expect(shouldFollowOverlay("countdown", true, false)).toBe(true);
    expect(shouldFollowOverlay("countdown", false, false)).toBe(false);
    expect(shouldFollowOverlay("idle", false, true)).toBe(false);
  });
});
