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
    expect(() =>
      child.emit(
        "error",
        Object.assign(new Error("spawn xdg-open ENOENT"), { code: "ENOENT" }),
      ),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      "Could not auto-open browser (xdg-open not installed). Open the printed URL manually.",
    );
    expect(child.unref).toHaveBeenCalledOnce();
  });
});
