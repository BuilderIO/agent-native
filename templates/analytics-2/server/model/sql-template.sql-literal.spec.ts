import { describe, expect, it } from "vitest";

import { compileSqlTemplate, sqlTemplateInputNames } from "./sql-template.js";

const exact = "SELECT {{ selected_borough | sql_literal }} AS picked";

describe("sql_literal template filter", () => {
  it("reads the input name from the exact filter syntax", () => {
    expect(sqlTemplateInputNames(exact)).toEqual(["selected_borough"]);
    expect(
      sqlTemplateInputNames(
        "WHERE boroname = {{selected_borough|sql_literal}}",
      ),
    ).toEqual(["selected_borough"]);
  });

  it("binds a scalar as a parameter without needing an identifier allowlist", () => {
    const { sql, parameters } = compileSqlTemplate(exact, {
      selected_borough: "Brooklyn",
    });
    expect(sql).toBe("SELECT @template_0 AS picked");
    expect(parameters).toEqual([
      {
        name: "template_0",
        parameterType: { type: "STRING" },
        parameterValue: { value: "Brooklyn" },
      },
    ]);
  });

  it("never interpolates a quote-breaking value into the SQL text", () => {
    const hostile = "x' OR 1=1; DROP TABLE t; --";
    const { sql, parameters } = compileSqlTemplate(
      "WHERE boroname = {{ b | sql_literal }}",
      { b: hostile },
      {},
      { positional: true },
    );
    expect(sql).toBe("WHERE boroname = $1");
    expect(sql).not.toContain("DROP");
    expect(parameters[0]?.parameterValue.value).toBe(hostile);
  });

  it("keeps a number typed", () => {
    const { parameters } = compileSqlTemplate("LIMIT {{ n | sql_literal }}", {
      n: 5,
    });
    expect(parameters[0]?.parameterType.type).toBe("INT64");
  });

  it("rejects an array value as a scalar error", () => {
    expect(() =>
      compileSqlTemplate(exact, { selected_borough: ["a", "b"] }),
    ).toThrow("Expected a single SQL template value: selected_borough");
  });

  it("rejects a missing value", () => {
    expect(() => compileSqlTemplate(exact, {})).toThrow(
      "Missing SQL template value: selected_borough",
    );
  });

  it("keeps unknown filters loudly invalid and the list contracts intact", () => {
    expect(() =>
      compileSqlTemplate("SELECT {{ a | upper }}", { a: "x" }),
    ).toThrow("Invalid SQL template placeholder");
    expect(() =>
      compileSqlTemplate("SELECT {{ a | sql_literal | upper }}", { a: "x" }),
    ).toThrow("Invalid SQL template placeholder");
    expect(compileSqlTemplate("IN ({{ a:list }})", { a: ["x", "y"] }).sql).toBe(
      "IN (@template_0, @template_1)",
    );
    expect(
      compileSqlTemplate("IN ({{ a | array }})", { a: ["x", "y"] }).sql,
    ).toBe("IN (@template_0, @template_1)");
    expect(() =>
      compileSqlTemplate("IN ({{ a | array }})", { a: "x" }),
    ).toThrow("Expected a nonempty SQL template list: a");
  });

  it("still requires an allowlist for a plain scalar identifier", () => {
    expect(() => compileSqlTemplate("FROM {{ t }}", { t: "orders" })).toThrow(
      "SQL template identifier is not allowed: t",
    );
  });
});

describe("quoted filtered placeholders", () => {
  const quotedForms = [
    "'{{ b | sql_literal }}'",
    "' {{ b | sql_literal }} '",
    "'{{b|sql_literal}}'",
    "'{{ b:list }}'",
    "'{{ b | array }}'",
  ];

  for (const form of quotedForms) {
    for (const positional of [false, true]) {
      it(`rejects ${form} loudly (${positional ? "positional" : "named"}) instead of emitting a quoted parameter`, () => {
        expect(() =>
          compileSqlTemplate(
            `WHERE boroname = ${form}`,
            {
              b:
                form.includes("list") || form.includes("array")
                  ? ["x", "y"]
                  : "x",
            },
            {},
            { positional },
          ),
        ).toThrow("Filtered SQL template placeholders must not be quoted: b");
      });
    }
  }

  it("still reports the input name so the dependency graph sees the cell", () => {
    expect(
      sqlTemplateInputNames("WHERE boroname = '{{ b | sql_literal }}'"),
    ).toEqual(["b"]);
  });

  for (const positional of [false, true]) {
    it(`rejects placeholders inside longer quoted strings (${positional ? "positional" : "named"})`, () => {
      for (const literal of [
        "'abc {{ b | sql_literal }} def'",
        "'it''s {{ b | sql_literal }} here'",
      ]) {
        expect(sqlTemplateInputNames(`SELECT ${literal}`)).toEqual(["b"]);
        expect(() =>
          compileSqlTemplate(
            `SELECT ${literal}`,
            { b: "x" },
            {},
            { positional },
          ),
        ).toThrow("Filtered SQL template placeholders must not be quoted: b");
      }
    });

    it(`binds between separate SQL literals (${positional ? "positional" : "named"})`, () => {
      const { sql, parameters } = compileSqlTemplate(
        "SELECT 'abc', {{ b | sql_literal }}, 'def'",
        { b: "x" },
        {},
        { positional },
      );
      expect(sql).toBe(
        `SELECT 'abc', ${positional ? "$1" : "@template_0"}, 'def'`,
      );
      expect(parameters).toHaveLength(1);
    });
  }

  it("keeps the plain quoted form binding one parameter", () => {
    const { sql, parameters } = compileSqlTemplate("WHERE a = '{{ b }}'", {
      b: "x",
    });
    expect(sql).toBe("WHERE a = @template_0");
    expect(parameters).toHaveLength(1);
  });
});

describe("SQL lexical boundaries", () => {
  it("binds active placeholders after quoted literals, identifiers and comments", () => {
    const source = `SELECT "Signed-in user's share link", "escaped \\\" {{ignored}}", \`field_{{ignored}}\`, '''{{ignored}}'''
-- {{ignored}}
# {{ignored}}
/* {{ignored}} */ WHERE day >= '{{timeRange}}'`;
    expect(sqlTemplateInputNames(source)).toEqual(["timeRange"]);
    const compiled = compileSqlTemplate(source, { timeRange: "2026-01-01" });
    expect(compiled.sql).toBe(source.replace("'{{timeRange}}'", "@template_0"));
    expect(compiled.parameters[0]?.parameterValue.value).toBe("2026-01-01");
  });
});

it("handles conditional blocks only in active SQL and rejects malformed active markers", () => {
  const source = `SELECT "{{?ignored}}", \`{{/ignored}}\` /* {{broken */ {{?enabled}}WHERE x = '{{value}}'{{/enabled}}`;
  expect(sqlTemplateInputNames(source)).toEqual(["enabled", "value"]);
  expect(compileSqlTemplate(source, { enabled: "", value: "x" }).sql).toBe(
    `SELECT "{{?ignored}}", \`{{/ignored}}\` /* {{broken */ `,
  );
  expect(
    compileSqlTemplate(source, { enabled: "yes", value: "x" }).sql,
  ).toContain("WHERE x = @template_0");
  expect(() => compileSqlTemplate("SELECT {{ bad | nope }}", {})).toThrow(
    "Invalid SQL template placeholder",
  );
  expect(() =>
    compileSqlTemplate("{{?a}}{{?b}}x{{/b}}{{/a}}", { a: "yes", b: "yes" }),
  ).toThrow("Invalid or nested SQL template block");
});

it("skips escaped quotes and triple strings before binding", () => {
  const source = `SELECT 'it\\'s fine', "it\\\"s {{hidden}}", \`escaped\\\`{{hidden}}\`, """{{hidden}} '""" WHERE x = '{{value}}'`;
  expect(sqlTemplateInputNames(source)).toEqual(["value"]);
  expect(compileSqlTemplate(source, { value: "ok" }).sql).toBe(
    source.replace("'{{value}}'", "@template_0"),
  );
});

it("does not bind markers in raw or bytes literals", () => {
  const source = `SELECT r'{{ignored}}', b'{{ignored}}', br'{{ignored}}', '{{value}}'`;
  expect(sqlTemplateInputNames(source)).toEqual(["value"]);
  expect(compileSqlTemplate(source, { value: "ok" }).sql).toBe(
    source.replace("'{{value}}'", "@template_0"),
  );
});
