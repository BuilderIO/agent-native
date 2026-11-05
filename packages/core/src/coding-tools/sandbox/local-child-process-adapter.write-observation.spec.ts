import { spawn } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalChildProcessAdapter } from "./local-child-process-adapter.js";

// A sandbox run starts a child process that the framework cannot watch, so the
// adapter reports that write before it spawns. The temp directory and module
// file it writes first stay private to the run and are not reported.
const mocks = vi.hoisted(() => ({
  noteExternalWrite: vi.fn(),
}));

vi.mock("../../action.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../action.js")>()),
  noteExternalWrite: mocks.noteExternalWrite,
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

function callOrder(
  spy: { mock: { invocationCallOrder: number[] } },
  index = 0,
): number {
  const order = spy.mock.invocationCallOrder[index];
  if (order === undefined) {
    throw new Error(`Expected call ${index} to be recorded.`);
  }
  return order;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("LocalChildProcessAdapter write observation", () => {
  it("notes the child-process write before spawning the sandbox", async () => {
    const adapter = new LocalChildProcessAdapter();

    const result = await adapter.run({
      moduleSource: `console.log("observed");`,
      env: {},
      timeoutMs: 30_000,
      bridgePort: 0,
    });

    expect(result.stdout).toContain("observed");
    expect(result.exitCode).toBe(0);
    expect(mocks.noteExternalWrite).toHaveBeenCalledTimes(1);
    expect(mocks.noteExternalWrite).toHaveBeenCalledWith("child-process");
    expect(vi.mocked(spawn)).toHaveBeenCalledTimes(1);
    expect(callOrder(mocks.noteExternalWrite)).toBeLessThan(
      callOrder(vi.mocked(spawn)),
    );
  });
});
