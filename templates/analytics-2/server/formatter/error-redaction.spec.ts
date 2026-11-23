import { expect, it } from "vitest";

import { formatSqlWithConfig, stopSqlFluffRuntime } from "./sqlfluff.js";

it("keeps a rejected statement's text out of parse errors", async () => {
  const marker = "flagged_source_credential";
  try {
    const formatting = formatSqlWithConfig({
      config: "[sqlfluff]\ndialect = bigquery\ntemplater = raw\n",
      source: `select 1; ${marker}`,
    });
    await expect(formatting).rejects.toMatchObject({ code: "parse_error" });
    await expect(formatting).rejects.not.toThrow(marker);
  } finally {
    await stopSqlFluffRuntime();
  }
});
