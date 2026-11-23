import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  formatSqlWithConfig,
  MAX_FORMAT_SQL_BYTES,
  MAX_SQLFLUFF_CONFIG_BYTES,
  stopSqlFluffRuntime,
  validateSqlFluffConfig,
} from "./sqlfluff.js";

const assetsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../assets/formatter",
);

function config(
  options: {
    case?: "upper" | "lower";
    spaces?: 2 | 4 | 8;
    dialect?: string;
    templater?: string;
  } = {},
) {
  return `[sqlfluff]
dialect = ${options.dialect ?? "bigquery"}
templater = ${options.templater ?? "raw"}
[sqlfluff:rules:capitalisation.keywords]
capitalisation_policy = ${options.case ?? "upper"}
[sqlfluff:indentation]
indent_unit = space
tab_space_size = ${options.spaces ?? 4}
`;
}

async function expectFormatError(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

afterAll(async () => {
  await stopSqlFluffRuntime();
});

describe("SQLFluff config validation", () => {
  it("accepts a BigQuery config and reports the applied dialect", async () => {
    await expect(
      validateSqlFluffConfig(config({ case: "lower", spaces: 2 })),
    ).resolves.toEqual({
      valid: true,
      error: null,
      dialect: "bigquery",
      templater: "raw",
    });
  });

  it("falls back to BigQuery only when the config omits a dialect", async () => {
    await expect(
      validateSqlFluffConfig("[sqlfluff]\ntemplater = raw\n"),
    ).resolves.toMatchObject({ valid: true, dialect: "bigquery" });
    await expect(
      validateSqlFluffConfig(config({ dialect: "ansi" }), {
        fallbackDialect: "bigquery",
      }),
    ).resolves.toMatchObject({ valid: true, dialect: "ansi" });
  });

  it("rejects an invalid INI document", async () => {
    await expect(validateSqlFluffConfig("[sqlfluff\n")).resolves.toMatchObject({
      valid: false,
      error: { code: "invalid_config" },
    });
  });

  it("rejects an unknown dialect", async () => {
    await expect(
      validateSqlFluffConfig(config({ dialect: "not_a_dialect" })),
    ).resolves.toMatchObject({
      valid: false,
      error: { code: "invalid_dialect" },
    });
  });

  it("rejects an invalid explicit fallback dialect", async () => {
    await expect(
      validateSqlFluffConfig("[sqlfluff]\ntemplater = raw\n", {
        fallbackDialect: "not_a_dialect",
      }),
    ).resolves.toMatchObject({
      valid: false,
      error: { code: "invalid_dialect" },
    });
  });

  it("rejects invalid rule values", async () => {
    const invalid = config().replace("upper", "sideways");
    await expect(validateSqlFluffConfig(invalid)).resolves.toMatchObject({
      valid: false,
      error: { code: "invalid_config" },
    });
  });

  it("rejects unknown rule sections instead of silently ignoring them", async () => {
    const invalid = `${config()}[sqlfluff:rules:not.a.rule]\nfoo = bar\n`;
    await expect(validateSqlFluffConfig(invalid)).resolves.toMatchObject({
      valid: false,
      error: { code: "unknown_rule" },
    });
  });

  it("rejects SQLFluff 2-era rule aliases explicitly", async () => {
    const invalid = `${config()}[sqlfluff:rules:L003]\nfoo = bar\n`;
    await expect(validateSqlFluffConfig(invalid)).resolves.toMatchObject({
      valid: false,
      error: { code: "unknown_rule" },
    });
  });

  it("rejects unknown core keys and invalid integer options", async () => {
    await expect(
      validateSqlFluffConfig(`${config()}not_a_key = 1\n`),
    ).resolves.toMatchObject({
      valid: false,
      error: { code: "unknown_config_key" },
    });
    await expect(
      validateSqlFluffConfig(
        "[sqlfluff]\ndialect = bigquery\ntemplater = raw\nmax_line_length = nope\n",
      ),
    ).resolves.toMatchObject({
      valid: false,
      error: { code: "invalid_config" },
    });
  });

  it("rejects Python and dbt templaters", async () => {
    for (const templater of ["python", "dbt"]) {
      await expect(
        validateSqlFluffConfig(config({ templater })),
      ).resolves.toMatchObject({
        valid: false,
        error: { code: "unsupported_templater" },
      });
    }
  });

  it("rejects file/path templater options", async () => {
    for (const option of ["library_path", "load_macros_from_path"]) {
      const invalid = `${config({ templater: "jinja" })}[sqlfluff:templater:jinja]\n${option} = /tmp\n`;
      await expect(validateSqlFluffConfig(invalid)).resolves.toMatchObject({
        valid: false,
        error: { code: "unsupported_config" },
      });
    }
  });
});

describe("SQLFluff formatting", () => {
  it("applies keyword case", async () => {
    const source = "select a, b from t where a = 1 and b = 2";
    await expect(
      formatSqlWithConfig({ config: config({ case: "upper" }), source }),
    ).resolves.toMatchObject({
      formattedSource: "SELECT\n    a,\n    b\nFROM t\nWHERE a = 1 AND b = 2\n",
      changed: true,
    });
    await expect(
      formatSqlWithConfig({ config: config({ case: "lower" }), source }),
    ).resolves.toMatchObject({
      formattedSource: "select\n    a,\n    b\nfrom t\nwhere a = 1 and b = 2\n",
      changed: true,
    });
  });

  it("applies 2, 4, and 8 space indentation", async () => {
    const source = "select a, b from t where a = 1 and b = 2";
    const expected: Record<number, string> = {
      2: "select\n  a,\n  b\nfrom t\nwhere a = 1 and b = 2\n",
      4: "select\n    a,\n    b\nfrom t\nwhere a = 1 and b = 2\n",
      8: "select\n        a,\n        b\nfrom t\nwhere a = 1 and b = 2\n",
    };
    for (const spaces of [2, 4, 8] as const) {
      await expect(
        formatSqlWithConfig({
          config: config({ case: "lower", spaces }),
          source,
        }),
      ).resolves.toMatchObject({ formattedSource: expected[spaces] });
    }
  });

  it("does not retain config or SQL between requests", async () => {
    const source = "select a, b from t where a = 1 and b = 2";
    await expect(
      formatSqlWithConfig({ config: config({ case: "upper" }), source }),
    ).resolves.toMatchObject({
      formattedSource: "SELECT\n    a,\n    b\nFROM t\nWHERE a = 1 AND b = 2\n",
    });
    await expect(
      formatSqlWithConfig({ config: config({ case: "lower" }), source }),
    ).resolves.toMatchObject({
      formattedSource: "select\n    a,\n    b\nfrom t\nwhere a = 1 and b = 2\n",
    });
  });

  it("accepts already-formatted SQL as a successful no-op", async () => {
    const configText = config({ case: "lower", spaces: 2 });
    const source = "select\n  a,\n  b\nfrom t\nwhere a = 1 and b = 2\n";
    await expect(
      formatSqlWithConfig({ config: configText, source }),
    ).resolves.toMatchObject({
      formattedSource: source,
      changed: false,
    });
  });

  it("reports parse failures separately from no-op success", async () => {
    await expectFormatError(
      formatSqlWithConfig({ config: config(), source: "select from where (" }),
      "parse_error",
    );
  });

  it("keeps Jinja sandbox escapes as template failures", async () => {
    await expectFormatError(
      formatSqlWithConfig({
        config: config({ templater: "jinja" }),
        source: "select {{ ''.__class__.__mro__ }}",
      }),
      "template_error",
    );
  });

  it("does not echo SQL in error messages", async () => {
    const source = "select secret_column from where (";
    try {
      await formatSqlWithConfig({ config: config(), source });
      throw new Error("expected failure");
    } catch (error) {
      expect((error as Error).message).not.toContain(source);
      expect((error as Error).message).not.toContain("secret_column");
    }
  });
});

describe("runtime bounds and isolation", () => {
  it("rejects oversized config and SQL before spawning", async () => {
    await expect(
      validateSqlFluffConfig("x".repeat(MAX_SQLFLUFF_CONFIG_BYTES + 1)),
    ).resolves.toMatchObject({
      valid: false,
      error: { code: "config_too_large" },
    });
    await expectFormatError(
      formatSqlWithConfig({
        config: config(),
        source: "x".repeat(MAX_FORMAT_SQL_BYTES + 1),
      }),
      "sql_too_large",
    );
  });

  it("runs the compiled child from bundled assets", () => {
    const childPath = path.join(assetsDir, "child.mjs");
    const result = spawnSync(
      process.execPath,
      [childPath, assetsDir, "--once"],
      {
        cwd: assetsDir,
        env: {},
        input: JSON.stringify({
          type: "format",
          config: config({ case: "lower", spaces: 2 }),
          source: "select a, b from t where a = 1 and b = 2",
          fallbackDialect: "bigquery",
        }),
        encoding: "utf8",
        timeout: 120_000,
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      valid: true,
      changed: true,
      formattedSource: "select\n  a,\n  b\nfrom t\nwhere a = 1 and b = 2\n",
    });
  });

  it("kills the exact child on deadline and restarts successfully", async () => {
    const configText = config({ case: "lower" });
    const source = "select a, b from t where a = 1 and b = 2";
    await expectFormatError(
      formatSqlWithConfig({ config: configText, source, deadlineMs: 1 }),
      "deadline",
    );
    await expect(
      formatSqlWithConfig({ config: configText, source }),
    ).resolves.toMatchObject({ changed: true });
  });
});
