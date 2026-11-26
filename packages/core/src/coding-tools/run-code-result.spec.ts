import { describe, expect, it } from "vitest";

import { runCodeResultFailure, runCodeStatusLines } from "./run-code-result.js";

describe("runCodeResultFailure", () => {
  it("names a crash by its error line", () => {
    const result = [
      ...runCodeStatusLines({ timedOut: false, timeoutMs: 1, exitCode: 1 }),
      "stdout:\nError: this line was printed, not thrown",
      "stderr:\nfile:///tmp/sandbox.mjs:3\n\nTypeError: boom\n    at run (file:///tmp/sandbox.mjs:3:9)",
    ].join("\n\n");
    expect(runCodeResultFailure(result)).toBe("TypeError: boom");
  });

  it("prefers the sandbox's unhandled error message", () => {
    expect(
      runCodeResultFailure(
        "exitCode: 1\n\nstderr:\nUnhandled error: Request failed",
      ),
    ).toBe("Request failed");
  });

  it("falls back to the status lines when stderr names no error", () => {
    const status = runCodeStatusLines({
      timedOut: true,
      timeoutMs: 120_000,
      exitCode: 143,
    });
    expect(runCodeResultFailure([...status, "(no output)"].join("\n\n"))).toBe(
      "timedOut: true (120000ms), exitCode: 143",
    );
  });

  it("passes a clean exit, even when its output mentions an exit code", () => {
    expect(runCodeResultFailure("stdout:\n1\n4\n9")).toBeUndefined();
    expect(
      runCodeResultFailure("stdout:\nexitCode: 1 is just text"),
    ).toBeUndefined();
    expect(
      runCodeResultFailure("stdout:\nheader\n\nexitCode: 1\n\nfooter"),
    ).toBeUndefined();
    expect(runCodeResultFailure({ exitCode: 1 })).toBeUndefined();
  });
});
