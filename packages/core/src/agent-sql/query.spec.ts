import { describe, expect, it } from "vitest";

import { AgentSqlSyntaxError } from "./lexer.js";
import { readAgentSqlQuery, rewriteAgentSqlQuerySources } from "./query.js";

const postgres = (sql: string) =>
  readAgentSqlQuery(sql, { dialect: "postgres" });
const bigquery = (sql: string) =>
  readAgentSqlQuery(sql, { dialect: "bigquery" });
const bindings = (sql: string) =>
  postgres(sql).sources.map(({ name, cte }) => [name, cte]);

describe("readAgentSqlQuery", () => {
  it("discovers every FROM, JOIN and comma source with aliases and exact spans", () => {
    const sql =
      'SELECT a.id FROM ONLY Public."Events" AS a JOIN summaries s USING (id), totals AS t';
    const query = postgres(sql);
    expect(
      query.sources.map(
        ({ name, qualifiers, modifiers, alias, commaSeparated }) => ({
          name,
          qualifiers,
          modifiers,
          alias,
          commaSeparated,
        }),
      ),
    ).toEqual([
      {
        name: "Events",
        qualifiers: ["public"],
        modifiers: ["only"],
        alias: { name: "a", quoted: false },
        commaSeparated: false,
      },
      {
        name: "summaries",
        qualifiers: [],
        modifiers: [],
        alias: { name: "s", quoted: false },
        commaSeparated: false,
      },
      {
        name: "totals",
        qualifiers: [],
        modifiers: [],
        alias: { name: "t", quoted: false },
        commaSeparated: true,
      },
    ]);
    expect(
      query.sources.map((source) => sql.slice(source.start, source.end)),
    ).toEqual(['Public."Events"', "summaries", "totals"]);
    expect(query.tokens[0]).toMatchObject({ text: "SELECT", start: 0, end: 6 });
    expect(query.sql).toBe(sql);
  });

  it("uses PostgreSQL ASCII folding while preserving quoted and non-ASCII names", () => {
    const query = postgres(
      'SELECT * FROM EVENTS, "Events", ÖRDERS, "odd""name"',
    );
    expect(query.sources.map(({ name }) => name)).toEqual([
      "events",
      "Events",
      "Örders",
      'odd"name',
    ]);
  });

  it("preserves BigQuery table spelling and splits quoted physical paths", () => {
    const query = bigquery(
      "SELECT * FROM Events e JOIN `example-project.DataSet.Events` p ON e.id = p.id",
    );
    expect(
      query.sources.map(({ name, qualifiers }) => ({ name, qualifiers })),
    ).toEqual([
      { name: "Events", qualifiers: [] },
      { name: "Events", qualifiers: ["example-project", "DataSet"] },
    ]);
    expect(query.sql.slice(query.sources[1].start, query.sources[1].end)).toBe(
      "`example-project.DataSet.Events`",
    );
  });

  it("tracks sequential CTE visibility and column lists", () => {
    const sql =
      "WITH first(id) AS (SELECT id FROM events), second(id) AS (SELECT id FROM first) SELECT * FROM second";
    expect(bindings(sql)).toEqual([
      ["events", false],
      ["first", true],
      ["second", true],
    ]);
    expect(postgres(sql).ctes.map(({ name }) => name)).toEqual([
      "first",
      "second",
    ]);
  });

  it("does not treat self-references or forward references as nonrecursive CTEs", () => {
    expect(
      bindings(
        "WITH first AS (SELECT * FROM first JOIN second USING (id)), second AS (SELECT * FROM events) SELECT * FROM first",
      ),
    ).toEqual([
      ["first", false],
      ["second", false],
      ["events", false],
      ["first", true],
    ]);
  });

  it("makes recursive CTE bindings visible throughout their WITH clause", () => {
    expect(
      bindings(
        "WITH RECURSIVE first AS (SELECT * FROM first UNION ALL SELECT * FROM second), second AS (SELECT * FROM events) SELECT * FROM first",
      ),
    ).toEqual([
      ["first", true],
      ["second", true],
      ["events", false],
      ["first", true],
    ]);
  });

  it("does not let an inner CTE authorize unrelated outer or sibling sources", () => {
    expect(
      bindings(
        "SELECT * FROM (WITH hidden AS (SELECT * FROM events) SELECT * FROM hidden) inner_query JOIN hidden ON true WHERE EXISTS (SELECT * FROM hidden)",
      ),
    ).toEqual([
      ["events", false],
      ["hidden", true],
      ["hidden", false],
      ["hidden", false],
    ]);
  });

  it("keeps outer CTE visibility inside subqueries and separate UNION branches", () => {
    expect(
      bindings(
        "WITH visible AS (SELECT * FROM events) SELECT * FROM (SELECT * FROM visible) nested UNION ALL (SELECT * FROM visible)",
      ),
    ).toEqual([
      ["events", false],
      ["visible", true],
      ["visible", true],
    ]);
  });

  it("retains an outer binding in a nonrecursive inner CTE body", () => {
    expect(
      bindings(
        "WITH visible AS (SELECT * FROM events) SELECT * FROM (WITH visible AS (SELECT * FROM visible) SELECT * FROM visible) nested",
      ),
    ).toEqual([
      ["events", false],
      ["visible", true],
      ["visible", true],
    ]);
  });

  it("does not infer CTE declarations from arbitrary AS parentheses", () => {
    expect(
      bindings(
        "SELECT * FROM (SELECT id AS hidden FROM events) nested JOIN hidden ON true",
      ),
    ).toEqual([
      ["events", false],
      ["hidden", false],
    ]);
    expect(postgres("SELECT CAST(id AS INTEGER) FROM events").ctes).toEqual([]);
  });

  it("honors quoted PostgreSQL CTE names and never binds qualified relations", () => {
    expect(
      bindings(
        'WITH "Visible" AS (SELECT 1) SELECT * FROM "Visible", visible, public."Visible"',
      ),
    ).toEqual([
      ["Visible", true],
      ["visible", false],
      ["Visible", false],
    ]);
  });

  it("matches BigQuery CTE references case-insensitively without folding physical names", () => {
    const query = bigquery(
      "WITH Visible AS (SELECT * FROM Events) SELECT * FROM visible JOIN `VISIBLE` USING (id)",
    );
    expect(query.sources.map(({ name, cte }) => [name, cte])).toEqual([
      ["Events", false],
      ["visible", true],
      ["VISIBLE", true],
    ]);
  });

  it("reads lateral subqueries, alias column lists and ONLY wrapped relations", () => {
    expect(
      bindings(
        "SELECT * FROM ONLY (events) e(id) JOIN LATERAL (SELECT * FROM summaries) s ON true",
      ),
    ).toEqual([
      ["events", false],
      ["summaries", false],
    ]);
  });

  it("reads join variants and CTE materialization without confusing column commas", () => {
    const sql =
      "WITH visible(a,b) AS NOT MATERIALIZED (SELECT a,b FROM events) SELECT * FROM visible NATURAL LEFT OUTER JOIN summaries CROSS JOIN totals JOIN records USING (a,b) WHERE true GROUP BY a,b HAVING count(*) > 0 ORDER BY a,b LIMIT 10";
    expect(bindings(sql)).toEqual([
      ["events", false],
      ["visible", true],
      ["summaries", false],
      ["totals", false],
      ["records", false],
    ]);
  });

  it("scopes nested CTEs separately in set-operation branches", () => {
    expect(
      bindings(
        "(WITH hidden AS (SELECT * FROM events) SELECT * FROM hidden) INTERSECT SELECT * FROM hidden EXCEPT SELECT * FROM summaries",
      ),
    ).toEqual([
      ["events", false],
      ["hidden", true],
      ["hidden", false],
      ["summaries", false],
    ]);
  });

  it("reads scalar subqueries nested inside function arguments", () => {
    expect(
      bindings(
        "SELECT substring(name FROM (SELECT id FROM summaries) FOR 3) FROM events",
      ),
    ).toEqual([
      ["summaries", false],
      ["events", false],
    ]);
  });

  it("finds scalar and condition subqueries without treating function FROM as a source", () => {
    const query = postgres(
      "SELECT EXTRACT(YEAR FROM created_at), TRIM(BOTH 'x' FROM name), (SELECT max(id) FROM summaries) FROM events e JOIN totals t ON t.id = (SELECT id FROM records) WHERE id IN (SELECT id FROM allowed)",
    );
    expect(query.sources.map(({ name }) => name)).toEqual([
      "summaries",
      "events",
      "totals",
      "records",
      "allowed",
    ]);
  });

  it("uses lexer boundaries for comments, carriage returns, dollar quotes and strings", () => {
    const sql =
      "-- FROM ignored\rSELECT $$FROM ignored$$, 'JOIN ignored', id FROM /* source */ events -- JOIN ignored\rJOIN summaries USING (id); -- FROM ignored";
    const query = postgres(sql);
    expect(query.sources.map(({ name }) => name)).toEqual([
      "events",
      "summaries",
    ]);
    expect(query.tokens.at(-1)?.text).toBe(";");
  });

  it("supports BigQuery SELECT * EXCEPT and quoted strings containing source syntax", () => {
    const query = bigquery(
      'SELECT * EXCEPT(secret), "FROM ignored" FROM events UNION ALL SELECT * EXCEPT(secret) FROM summaries',
    );
    expect(query.sources.map(({ name }) => name)).toEqual([
      "events",
      "summaries",
    ]);
  });

  it.each([
    "SELECT * FROM generate_series(1, 3)",
    "SELECT * FROM public.generate_series(1, 3)",
    "SELECT * FROM ROWS FROM (generate_series(1, 3))",
    "SELECT * FROM (events JOIN summaries USING (id)) grouped",
    "SELECT * FROM (events) grouped",
    "SELECT * FROM events TABLESAMPLE SYSTEM (10)",
    "SELECT * FROM events*",
    "SELECT * FROM public.",
    "SELECT * FROM events,",
    "SELECT * FROM events JOIN",
    "SELECT * FROM",
    "SELECT * FROM events AS",
    "SELECT * FROM events JOIN summaries USING ()",
    "SELECT * FROM events JOIN summaries ON",
    "WITH visible(id,) AS (SELECT 1) SELECT * FROM visible",
    "WITH visible AS (DELETE FROM events RETURNING *) SELECT * FROM visible",
    "WITH visible AS (SELECT 1), visible AS (SELECT 2) SELECT * FROM visible",
    "SELECT * FROM events; SELECT * FROM summaries",
    "SELECT * FROM events;;",
    ";SELECT * FROM events",
    "SELECT (id FROM events",
    "SELECT [id) FROM events",
    "SELECT * FROM events)",
    "SELECT * FROM events FROM summaries",
    "SELECT * FROM events WHERE true FROM summaries",
    "",
  ])(
    "fails loudly for unsupported or malformed source structure: %s",
    (sql) => {
      expect(() => postgres(sql)).toThrow(AgentSqlSyntaxError);
    },
  );

  it.each([
    "SELECT * FROM UNNEST([1,2])",
    "SELECT * FROM events PIVOT(SUM(id) FOR kind IN ('a'))",
    "SELECT * FROM events WITH OFFSET",
    "SELECT * FROM `example..events`",
    "SELECT * FROM `events*`",
    "SELECT * FROM `example.dataset.events$20261001`",
    "SELECT * FROM `example.dataset.events@1234`",
  ])("rejects unsupported BigQuery source syntax: %s", (sql) => {
    expect(() => bigquery(sql)).toThrow(AgentSqlSyntaxError);
  });

  it("bounds nesting and rejects PostgreSQL identifier truncation", () => {
    expect(() =>
      postgres(`SELECT ${"(".repeat(129)}1${")".repeat(129)}`),
    ).toThrow(AgentSqlSyntaxError);
    expect(() => postgres(`SELECT * FROM ${"a".repeat(64)}`)).toThrow(
      AgentSqlSyntaxError,
    );
  });
});

describe("rewriteAgentSqlQuerySources", () => {
  it("replaces a qualified source path with comments around its dots", () => {
    const query = postgres(
      'SELECT e.id FROM public /* qualifier */ . "Events" e WHERE e.id > 0',
    );
    expect(rewriteAgentSqlQuerySources(query, () => "scoped_events")).toBe(
      "SELECT e.id FROM scoped_events e WHERE e.id > 0",
    );
  });

  it("rewrites every physical source and preserves modifiers, aliases, comments and literals", () => {
    const sql =
      "-- prefix\rWITH kept AS (SELECT * FROM events) SELECT 'FROM events' FROM ONLY events e JOIN kept k USING (id), summaries /* suffix */;";
    const query = postgres(sql);
    expect(
      rewriteAgentSqlQuerySources(query, (source) =>
        source.cte
          ? sql.slice(source.start, source.end)
          : `(SELECT * FROM scoped_${source.name})`,
      ),
    ).toBe(
      "-- prefix\rWITH kept AS (SELECT * FROM (SELECT * FROM scoped_events)) SELECT 'FROM events' FROM ONLY (SELECT * FROM scoped_events) e JOIN kept k USING (id), (SELECT * FROM scoped_summaries) /* suffix */;",
    );
  });

  it("preserves source text when no replacement changes it", () => {
    const query = postgres(" SELECT 1; -- trailing");
    expect(rewriteAgentSqlQuerySources(query, () => "unused")).toBe(query.sql);
  });

  it("refuses overlapping or invalid spans and empty replacements", () => {
    const query = postgres("SELECT * FROM events");
    expect(() =>
      rewriteAgentSqlQuerySources(
        { ...query, sources: [...query.sources, ...query.sources] },
        () => "scoped",
      ),
    ).toThrow(AgentSqlSyntaxError);
    expect(() =>
      rewriteAgentSqlQuerySources(
        {
          ...query,
          sources: [{ ...query.sources[0], end: query.sql.length + 1 }],
        },
        () => "scoped",
      ),
    ).toThrow(AgentSqlSyntaxError);
    expect(() => rewriteAgentSqlQuerySources(query, () => "")).toThrow(
      AgentSqlSyntaxError,
    );
    expect(() =>
      rewriteAgentSqlQuerySources(
        {
          ...query,
          sources: [{ ...query.sources[0], start: query.sources[0].start + 1 }],
        },
        () => "scoped",
      ),
    ).toThrow(AgentSqlSyntaxError);
    expect(() =>
      rewriteAgentSqlQuerySources(
        { ...query, sql: query.sql.replace("events", "hidden") },
        () => "scoped",
      ),
    ).toThrow(AgentSqlSyntaxError);
  });
});
