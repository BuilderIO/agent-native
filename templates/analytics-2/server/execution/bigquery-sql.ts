import {
  lexAgentSql,
  readAgentSqlQuery,
  type AgentSqlToken,
} from "@agent-native/core/agent-sql";

const ALLOWED_TABLE_FUNCTIONS = new Set([
  "builder-3b0a2.analytics.first_party_analytics_events_raw_query_range",
]);

export function readBigQuerySources(query: string) {
  return readAgentSqlQuery(
    fromSyntaxAsSubqueries(tableFunctionAsTable(query)),
    { dialect: "bigquery" },
  ).sources.map(({ qualifiers, cte }) => ({ qualifiers, cte }));
}

// The shared reader rejects every table function; an allow-listed one with
// scalar arguments is read as the plain table it is named after.
function tableFunctionAsTable(query: string) {
  const tokens = lexAgentSql(query, { dialect: "bigquery" });
  let rewritten = "";
  let copied = 0;
  tokens.forEach((token, index) => {
    const open = tokens[index + 1];
    if (
      token.kind !== "quoted-identifier" ||
      !ALLOWED_TABLE_FUNCTIONS.has(token.value.toLowerCase()) ||
      open?.kind !== "punctuation" ||
      open.text !== "(" ||
      token.start < copied
    )
      return;
    const closeIndex = matchingClose(tokens, index + 1);
    const close = tokens[closeIndex];
    if (!close) return;
    for (const inner of tokens.slice(index + 2, closeIndex))
      if (inner.kind === "word" && inner.value === "select")
        throw new Error("Table function arguments cannot contain queries.");
    rewritten += query.slice(copied, open.start);
    copied = close.end;
  });
  return rewritten + query.slice(copied);
}

function matchingClose(tokens: AgentSqlToken[], open: number) {
  let depth = 0;
  for (let index = open; index < tokens.length; index++) {
    const token = tokens[index];
    if (token?.kind !== "punctuation") continue;
    if (token.text === "(") depth++;
    else if (token.text === ")" && --depth === 0) return index;
  }
  throw new Error("Unbalanced table function call.");
}

const FROM_SYNTAX = [
  { words: ["unnest", "("], replacement: "(select " },
  { words: ["with", "offset"], replacement: "cross join (select 1)" },
  { words: ["pivot", "("], replacement: "cross join (select " },
  { words: ["unpivot", "("], replacement: "cross join (select " },
  {
    words: ["unpivot", "include", "nulls", "("],
    replacement: "cross join (select ",
  },
  {
    words: ["unpivot", "exclude", "nulls", "("],
    replacement: "cross join (select ",
  },
  { words: ["tablesample", "system", "("], replacement: "cross join (select " },
];

function fromSyntaxAsSubqueries(query: string) {
  const tokens = lexAgentSql(query, { dialect: "bigquery" });
  let rewritten = "";
  let copied = 0;
  tokens.forEach((token, index) => {
    if (
      token.kind === "quoted-identifier" &&
      token.text.endsWith("*`") &&
      (token.value.includes(".") || tokens[index - 1]?.text === ".")
    ) {
      rewritten += `${query.slice(copied, token.end - 2)}_`;
      copied = token.end - 1;
      return;
    }
    const syntax = FROM_SYNTAX.find(({ words }) =>
      words.every((text, offset) => {
        const next = tokens[index + offset];
        return (
          (next?.kind === "word" || next?.kind === "punctuation") &&
          next.value === text
        );
      }),
    );
    if (!syntax) return;
    const last = tokens[index + syntax.words.length - 1];
    if (!last) return;
    rewritten += query.slice(copied, token.start) + syntax.replacement;
    copied = last.end;
  });
  return rewritten + query.slice(copied);
}
