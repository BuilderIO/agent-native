import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createOpenUrlLatch,
  openExtensionLink,
  readOpenUrlToken,
} from "./open-extension-link.js";

const TOKEN = "0123456789abcdef0123456789abcdef";

describe("openExtensionLink", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens web links in a new tab without an opener", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    const url = "https://app.hubspot.com/contacts/1/company/2";

    expect(openExtensionLink({ url, token: TOKEN }, TOKEN)).toBe(true);
    expect(open).toHaveBeenCalledWith(url, "_blank", "noopener,noreferrer");
  });

  it("refuses and warns about requests without the latched token", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const url = "https://example.com/";

    expect(openExtensionLink({ url }, TOKEN)).toBe(false);
    expect(openExtensionLink({ url, token: "other" }, TOKEN)).toBe(false);
    expect(openExtensionLink({ url, token: TOKEN }, null)).toBe(false);
    expect(openExtensionLink(null, TOKEN)).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it("refuses and warns about anything that isn't an http(s) URL", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const urls = [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "blob:https://example.com/1",
      "/relative/path",
      "",
      42,
      undefined,
    ];

    for (const url of urls) {
      expect(openExtensionLink({ url, token: TOKEN }, TOKEN)).toBe(false);
    }
    expect(open).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(urls.length);
  });
});

describe("readOpenUrlToken", () => {
  it("only latches a 32-character hex token", () => {
    expect(readOpenUrlToken({ openUrlToken: TOKEN })).toBe(TOKEN);
    expect(readOpenUrlToken({ openUrlToken: TOKEN.toUpperCase() })).toBeNull();
    expect(readOpenUrlToken({ openUrlToken: "short" })).toBeNull();
    expect(readOpenUrlToken({ openUrlToken: `${TOKEN}0` })).toBeNull();
    expect(readOpenUrlToken({ openUrlToken: "" })).toBeNull();
    expect(readOpenUrlToken({ openUrlToken: 42 })).toBeNull();
    expect(readOpenUrlToken(null)).toBeNull();
  });
});

describe("createOpenUrlLatch", () => {
  const OTHER = "fedcba9876543210fedcba9876543210";
  const READY = { type: "agent-native-extension-open-url-ready" };
  const frameWindow = () => ({ postMessage: vi.fn() }) as unknown as Window;
  const binding = (openUrlToken: string) => ({
    type: "agent-native-extension-binding",
    openUrlToken,
  });
  const request = (token: string) => ({ url: "https://example.com/", token });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("latches a window's first binding and ignores later ones from it", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const latch = createOpenUrlLatch();
    const frame = frameWindow();

    latch.latch(binding(TOKEN), frame);
    // A page the frame navigated to re-announces from the same window.
    latch.latch(binding(OTHER), frame);

    expect(frame.postMessage).toHaveBeenCalledTimes(1);
    expect(frame.postMessage).toHaveBeenCalledWith(READY, "*");
    expect(latch.open(request(OTHER))).toBe(false);
    expect(latch.open(request(TOKEN))).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("latches afresh for a new iframe window, however it was mounted", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const latch = createOpenUrlLatch();
    const first = frameWindow();
    const remounted = frameWindow();

    latch.latch(binding(TOKEN), first);
    latch.latch(binding(OTHER), remounted);

    expect(remounted.postMessage).toHaveBeenCalledWith(READY, "*");
    expect(latch.open(request(OTHER))).toBe(true);
    // The old window's token no longer opens anything.
    expect(latch.open(request(TOKEN))).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("never opens or offers to when disabled or the binding has no token", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const disabled = createOpenUrlLatch();
    const frame = frameWindow();
    disabled.latch(binding(TOKEN), frame, false);
    const tokenless = createOpenUrlLatch();
    const other = frameWindow();
    tokenless.latch({ type: "agent-native-extension-binding" }, other);

    expect(frame.postMessage).not.toHaveBeenCalled();
    expect(other.postMessage).not.toHaveBeenCalled();
    expect(disabled.open(request(TOKEN))).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
