import { describe, expect, it } from "vitest";

import { childExitCode } from "./index.js";

// 57526 (orchestrator DECISION 19:25): the CLI's run() did `process.exit(code ?? 0)`, so a child killed by a signal exited 0 and a SIGKILLed
// `tsc` read as a passing preflight. A signal exit is NOT success: it is the signal's number plus 128, the shell convention, so a caller that only
// knows "nonzero = failed" is right and a caller that wants the signal still has it. A null code with no signal is unknown, and unknown never exits 0.
describe("childExitCode", () => {
  it("passes a real exit code through, including 0", () => {
    expect(childExitCode(0, null)).toBe(0);
    expect(childExitCode(1, null)).toBe(1);
    expect(childExitCode(2, null)).toBe(2);
    expect(childExitCode(142, null)).toBe(142);
  });

  it("turns a signal kill into a nonzero exit, 128 + the signal number", () => {
    expect(childExitCode(null, "SIGKILL")).toBe(137);
    expect(childExitCode(null, "SIGTERM")).toBe(143);
    expect(childExitCode(null, "SIGINT")).toBe(130);
  });

  it("never reports success for an exit it cannot classify", () => {
    expect(childExitCode(null, null)).toBe(1);
    expect(childExitCode(null, "SIGWEIRD")).toBe(1);
    expect(childExitCode(null, "SIGKILL")).not.toBe(0);
  });

  it("keeps a signal exit nonzero even when a code arrives alongside it", () => {
    // node gives (code, signal); when a child is killed the code is null, but a race can hand both. The signal wins, because the process did not
    // decide its own status.
    expect(childExitCode(0, "SIGKILL")).toBe(137);
  });
});
