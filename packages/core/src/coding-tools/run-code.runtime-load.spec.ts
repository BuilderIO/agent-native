import { describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ loads: 0, runners: 0, failRunners: 0 }));

vi.mock("run", async (importActual) => {
  runtime.loads += 1;
  const actual = await importActual<typeof import("run")>();
  return {
    ...actual,
    createRunner: ((...args: Parameters<typeof actual.createRunner>) => {
      runtime.runners += 1;
      if (runtime.failRunners > 0) {
        runtime.failRunners -= 1;
        throw new Error("QuickJS failed to start");
      }
      return actual.createRunner(...args);
    }) as typeof actual.createRunner,
  };
});

import { createRunCodeEntry, executeSandboxCode } from "./run-code.js";

describe("run-code's QuickJS runtime", () => {
  it("loads on the first Run-mode execution, once across concurrent first runs", async () => {
    createRunCodeEntry(() => ({}), { evaluator: "run" });
    expect(runtime).toMatchObject({ loads: 0, runners: 0 });

    const results = await Promise.all(
      ["first", "second"].map((label) =>
        executeSandboxCode({
          code: `console.log(${JSON.stringify(label)});`,
          timeoutMs: 30_000,
          getActions: () => ({}),
          evaluator: "run",
        }),
      ),
    );

    expect(results.map(({ exitCode, stdout }) => [exitCode, stdout])).toEqual([
      [0, expect.stringContaining("first")],
      [0, expect.stringContaining("second")],
    ]);
    expect(runtime).toMatchObject({ loads: 1, runners: 1 });
  });

  it("fails a run whose runtime fails to start, and starts it again on the next run", async () => {
    vi.resetModules();
    const fresh = await import("./run-code.js");
    runtime.runners = 0;
    runtime.failRunners = 1;
    const run = () =>
      fresh.executeSandboxCode({
        code: `console.log("again");`,
        timeoutMs: 30_000,
        getActions: () => ({}),
        evaluator: "run",
      });

    await expect(run()).rejects.toThrow("QuickJS failed to start");
    const retried = await run();

    expect([retried.exitCode, retried.stdout]).toEqual([
      0,
      expect.stringContaining("again"),
    ]);
    expect(runtime.runners).toBe(2);
  });
});
