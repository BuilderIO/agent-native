import { expect, it, vi } from "vitest";

it("rejects queued and subsequent work after shutdown without restarting its worker", async () => {
  vi.resetModules();
  const runtime = await import("./sqlfluff.js");
  const input = {
    config: "[sqlfluff]\ndialect = bigquery\ntemplater = raw\n",
    source: "select 1 as value",
  };
  try {
    await runtime.formatSqlWithConfig(input);
    const queued = Promise.allSettled([
      runtime.formatSqlWithConfig(input),
      runtime.formatSqlWithConfig(input),
    ]);
    await runtime.stopSqlFluffRuntime();
    const outcomes = await queued;
    expect(outcomes.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    await expect(runtime.formatSqlWithConfig(input)).rejects.toMatchObject({
      code: "runtime_error",
      message: "SQLFluff runtime stopped.",
    });
  } finally {
    await runtime.stopSqlFluffRuntime();
  }
});
