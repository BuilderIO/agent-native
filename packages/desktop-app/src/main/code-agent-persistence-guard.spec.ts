import { describe, expect, it, vi } from "vitest";

import { guardCodeAgentPersistence } from "./code-agent-persistence-guard.js";

describe("guardCodeAgentPersistence", () => {
  it("contains persistence failures from stdout handlers without logging payloads", () => {
    const warn = vi.fn();
    const persistenceFailure = new Error("secret stdout payload");

    expect(() =>
      guardCodeAgentPersistence(
        { runId: "run-123", source: "runner-stdout" },
        () => {
          throw persistenceFailure;
        },
        warn,
      ),
    ).not.toThrow();

    expect(warn).toHaveBeenCalledWith("Code agent persistence failed.", {
      runId: "run-123",
      source: "runner-stdout",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      "secret stdout payload",
    );
  });

  it("bounds the context it emits", () => {
    const warn = vi.fn();

    guardCodeAgentPersistence(
      { runId: "r".repeat(200), source: "s".repeat(200) },
      () => {
        throw new Error("failed");
      },
      warn,
    );

    expect(warn.mock.calls[0]?.[1]).toEqual({
      runId: "r".repeat(96),
      source: "s".repeat(96),
    });
  });
});
