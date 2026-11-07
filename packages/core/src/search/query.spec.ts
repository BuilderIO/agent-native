import type { SQL } from "drizzle-orm";
import { PgDialect, pgTable, text } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { parseSearchQuery } from "./query-parser.js";
import { indexedSearchSql } from "./query.js";

const notes = pgTable("notes", { id: text("id").primaryKey() });
const registration = {
  app: "notes",
  type: "note",
  table: notes,
  idColumn: notes.id,
  version: 1,
  load: async () => [],
};

function search(input: string, fields?: "all" | "title") {
  return indexedSearchSql({
    registration,
    query: parseSearchQuery(input),
    ...(fields ? { fields } : {}),
  });
}

function render(fragment: SQL) {
  const { sql, params } = new PgDialect().sqlToQuery(fragment);
  return { sql, params };
}

/** How many times the match reads a stored vector. */
function vectorTests(fragment: SQL) {
  return render(fragment).sql.split("search_index.doc_vector @@").length - 1;
}

const title = (n: number) => `search_index.title_norm LIKE $${n} ESCAPE '\\'`;
const summary = (n: number) =>
  `search_index.summary_norm LIKE $${n} ESCAPE '\\'`;
const vector = (n: number) => `search_index.doc_vector @@ $${n}::tsquery`;

describe("indexedSearchSql", () => {
  it("looks up each kept row's index entry instead of joining from the index", () => {
    const query = search("alpha");
    expect(render(query.join)).toEqual({
      sql: 'LATERAL (SELECT * FROM search_resources WHERE app = $1 AND resource_type = $2 AND resource_id = "notes"."id"::text OFFSET 0) AS search_index',
      params: ["notes", "note"],
    });
    expect(render(query.on)).toEqual({ sql: "true", params: [] });
  });

  it("tests plain words against the vector once, and group by group only through titles and summaries", () => {
    expect(render(search("alpha beta").match)).toEqual({
      sql:
        `(${vector(1)} or ((${title(2)} or ${summary(3)} or ${title(4)} or ${summary(5)})` +
        ` and (${title(6)} or ${summary(7)} or ${vector(8)})` +
        ` and (${title(9)} or ${summary(10)} or ${vector(11)})))`,
      params: [
        "('alpha':*) & ('beta':*)",
        "%alpha%",
        "%alpha%",
        "%beta%",
        "%beta%",
        "%alpha%",
        "%alpha%",
        "'alpha':*",
        "%beta%",
        "%beta%",
        "'beta':*",
      ],
    });
  });

  it("keeps each group's alternatives together in the one vector test", () => {
    const { params } = render(search("alpha OR delta beta").match);
    expect(params[0]).toBe("(('alpha':*) | ('delta':*)) & ('beta':*)");
    expect(params).toContain("('alpha':*) | ('delta':*)");
  });

  it("still excludes negatives after the one vector test", () => {
    const { sql, params } = render(search("alpha beta -gamma").match);
    expect(params[0]).toBe("('alpha':*) & ('beta':*)");
    expect(sql).toMatch(/\) and not \(/);
    expect(params.slice(-3)).toEqual(["%gamma%", "%gamma%", "'gamma':*"]);
  });

  it("matches a single word in any field directly", () => {
    expect(render(search("alpha").match)).toEqual({
      sql: `(${title(1)} or ${summary(2)} or ${vector(3)})`,
      params: ["%alpha%", "%alpha%", "'alpha':*"],
    });
  });

  it("tests a phrase group by group, matching it in any order where positions were dropped", () => {
    const { sql, params } = render(search('"alpha beta" gamma').match);
    expect(sql).toBe(
      `((${title(1)} or ${summary(2)} or (${vector(3)} OR (NOT search_index.positions_complete AND ${vector(4)})))` +
        ` and (${title(5)} or ${summary(6)} or ${vector(7)}))`,
    );
    expect(params[2]).toBe("'alpha' <-> 'beta':*");
    expect(params[6]).toBe("'gamma':*");
  });

  it("tests group by group when any alternative in a group is a phrase", () => {
    const match = search('"alpha beta" OR gamma delta').match;
    expect(render(match).params[0]).not.toContain(" & (");
    expect(vectorTests(match)).toBe(3);
  });

  it("tests group by group when a group can only match in titles", () => {
    const match = search("intitle:alpha beta").match;
    expect(render(match)).toEqual({
      sql: `(${title(1)} and (${title(2)} or ${summary(3)} or ${vector(4)}))`,
      params: ["%alpha%", "%beta%", "%beta%", "'beta':*"],
    });
  });

  it("never reads the vector when searching titles only", () => {
    expect(render(search("alpha beta", "title").match)).toEqual({
      sql: `(${title(1)} and ${title(2)})`,
      params: ["%alpha%", "%beta%"],
    });
  });

  it("ranks the whole query as a body phrase from the joined entry", () => {
    expect(render(search("alpha beta").bodyPhrase)).toEqual({
      sql: `case when ${vector(1)} then 1 else 0 end`,
      params: ["'alpha':C <-> 'beta':*C"],
    });
  });

  it("matches nothing for an empty query", () => {
    expect(render(search("").match)).toEqual({ sql: "false", params: [] });
  });
});
