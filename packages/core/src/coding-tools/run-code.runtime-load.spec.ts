import { describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ loads: 0, runners: 0 }));

vi.mock("run", async (importActual) => {
  runtime.loads += 1;
  const actual = await importActual<typeof import("run")>();
  return {
    ...actual,
    createRunner: ((...args: Parameters<typeof actual.createRunner>) => {
      runtime.runners += 1;
      return actual.createRunner(...args);
    }) as typeof actual.createRunner,
  };
});

import { createRunCodeEntry, executeSandboxCode } from "./run-code.js";

describe("run-code's QuickJS runtime", () => {
  it("loads on the first Run-mode execution, once across concurrent first runs", async () => {
    createRunCodeEntry(() => ({}), { evaluator: "run" });
    expect(runtime).toEqual({ loads: 0, runners: 0 });

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
    expect(runtime).toEqual({ loads: 1, runners: 1 });
  });
});
