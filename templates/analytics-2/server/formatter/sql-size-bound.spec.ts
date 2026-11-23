import { expect, it } from "vitest";

import { formatSqlWithConfig, stopSqlFluffRuntime } from "./sqlfluff.js";

it("formats SQL inside the advertised byte limit across the parent and worker boundary", async () => {
  const source = `--${"x".repeat(1_010_000)}\nselect 1 as value`;
  try {
    const result = await formatSqlWithConfig({
      config: "[sqlfluff]\ndialect = bigquery\ntemplater = raw\n",
      source,
    });
    expect(result.formattedSource).toContain("select 1 as value");
  } finally {
    await stopSqlFluffRuntime();
  }
});
