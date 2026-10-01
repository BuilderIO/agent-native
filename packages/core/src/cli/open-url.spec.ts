import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { openUrlInBrowser } from "./open-url.js";

describe("openUrlInBrowser", () => {
  it("warns and continues when the platform opener is missing", () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const spawnProcess = vi.fn(() => child) as never;
    const warn = vi.fn();

    openUrlInBrowser("http://localhost:8080", {
      platform: "linux",
      spawnProcess,
      warn,
    });

    expect(spawnProcess).toHaveBeenCalledWith(
      "xdg-open",
      ["http://localhost:8080"],
      expect.objectContaining({ detached: true, shell: false }),
    );
    expect(() => {
      child.emit(
        "error",
        Object.assign(new Error("spawn xdg-open ENOENT"), { code: "ENOENT" }),
      );
      child.emit("close", null, null);
    }).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      "Could not auto-open browser (xdg-open not installed). Open the printed URL manually.",
    );
    expect(warn).toHaveBeenCalledOnce();
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it("passes Windows URLs to cmd without an outer shell", () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const spawnProcess = vi.fn(() => child) as never;

    openUrlInBrowser("https://example.com/callback?code=x&state=y", {
      platform: "win32",
      spawnProcess,
      warn: vi.fn(),
    });

    expect(spawnProcess).toHaveBeenCalledWith(
      "cmd",
      ["/c", "start", "", "https://example.com/callback?code=x&state=y"],
      expect.objectContaining({ shell: false }),
    );
  });

  it("warns when the opener exits unsuccessfully", () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const spawnProcess = vi.fn(() => child) as never;
    const warn = vi.fn();

    openUrlInBrowser("http://localhost:8080", {
      platform: "linux",
      spawnProcess,
      warn,
    });
    child.emit("close", 1, null);

    expect(warn).toHaveBeenCalledWith(
      "Could not auto-open browser (xdg-open exited with code 1). Open the printed URL manually.",
    );
  });
});
