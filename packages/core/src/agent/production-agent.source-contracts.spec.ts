import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("run preparation source contract", () => {
  it("terminalizes a preclaimed row when turn persistence fails", () => {
    // source-read-ok: retain the existing preparation failure-ordering contract outside instrumented mutation tests.
    const source = readFileSync(
      new URL("./production-agent.ts", import.meta.url),
      "utf8",
    );
    const preparation = source.slice(
      source.indexOf("if (options.onRunPrepared"),
      source.indexOf("// ─── Durable-background dispatch decision"),
    );

    expect(preparation).toContain("await options.onRunPrepared");
    expect(preparation).toContain("if (foregroundRunRowInserted)");
    expect(preparation).toContain('updateRunStatusIfRunning(runId, "errored")');
    expect(preparation).toContain(
      'setRunTerminalReason(runId, "run_preparation_failed")',
    );
    expect(preparation).toMatch(
      /setRunError\(\s*runId,\s*"run_preparation_failed",\s*error instanceof Error \? error\.message : String\(error\)/,
    );
    expect(preparation).toContain("throw error");
  });
});
