import { afterAll, describe, expect, it } from "vitest";

import {
  formatSqlWithConfig,
  stopSqlFluffRuntime,
  validateSqlFluffConfig,
} from "./sqlfluff.js";

afterAll(async () => {
  await stopSqlFluffRuntime();
});

const PLACEHOLDER_CONFIG = `[sqlfluff]
dialect = bigquery
templater = placeholder
[sqlfluff:templater:placeholder]
param_style = colon
user_id = 42
`;

describe("worker config and source handling", () => {
  it("accepts placeholder values next to param_style and substitutes them", async () => {
    await expect(
      validateSqlFluffConfig(PLACEHOLDER_CONFIG),
    ).resolves.toMatchObject({
      valid: true,
      templater: "placeholder",
    });
    const result = await formatSqlWithConfig({
      config: PLACEHOLDER_CONFIG,
      source: "select * from t where id = :user_id",
    });
    expect(result.formattedSource).toBe("select * from t\nwhere id = :user_id\n");
  });

  it("still rejects path options inside the placeholder section", async () => {
    await expect(
      validateSqlFluffConfig(
        `${PLACEHOLDER_CONFIG}load_macros_from_path = /etc\n`,
      ),
    ).resolves.toMatchObject({
      valid: false,
      error: { code: "unsupported_config" },
    });
  });

  it("formats SQL that starts with a byte-order mark", async () => {
    const result = await formatSqlWithConfig({
      config: "",
      source: "\ufeffselect a from t",
    });
    expect(result.formattedSource).toBe("select a from t\n");
  });
});
