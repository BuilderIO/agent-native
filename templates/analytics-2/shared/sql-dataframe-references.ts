import { PostgreSQL } from "@codemirror/lang-sql";

const parser = PostgreSQL.language.parser;
type SqlNode = ReturnType<typeof parser.parse>["topNode"];

const endFrom = new Set([
  "where",
  "group",
  "having",
  "window",
  "order",
  "limit",
  "offset",
  "fetch",
  "union",
  "intersect",
  "except",
  "for",
  "returning",
]);

export function sqlDataframeReferences(
  source: string,
  options: {
    unqualifiedOnly?: boolean;
    dialect?: "bigquery" | "postgres" | "duckdb";
  } = {},
): Set<string> {
  const tables = new Set<string>();
  const text = (node: SqlNode | undefined) =>
    node ? source.slice(node.from, node.to) : "";
  const keyword = (node: SqlNode | undefined) => text(node).toLowerCase();
  const scopeName = (name: string) =>
    options.dialect === "duckdb"
      ? name.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
      : name;
  const identifier = (node: SqlNode | undefined) => {
    if (node?.name === "QuotedIdentifier")
      return text(node).slice(1, -1).replace(/""/g, '"');
    if (/^[a-z_][a-z0-9_$]*$/.test(keyword(node))) return keyword(node);
    return null;
  };

  function walk(node: SqlNode, outerCtes: ReadonlySet<string>, joined = false) {
    const tokens: SqlNode[] = [];
    for (let child = node.firstChild; child; child = child.nextSibling)
      if (!["(", ")", "LineComment", "BlockComment"].includes(child.name))
        tokens.push(child);

    const ctes = new Set(outerCtes);
    let index = 0;
    if (keyword(tokens[index]) === "with") {
      index++;
      const recursive = keyword(tokens[index]) === "recursive";
      if (recursive) index++;
      const definitions: { name: string; body: SqlNode }[] = [];
      for (;;) {
        const name = identifier(tokens[index++]);
        if (tokens[index]?.name === "Parens") index++;
        if (keyword(tokens[index++]) !== "as") break;
        if (keyword(tokens[index]) === "not") index++;
        if (keyword(tokens[index]) === "materialized") index++;
        const body = tokens[index++];
        if (!name || body?.name !== "Parens") break;
        definitions.push({ name, body });
        if (text(tokens[index]) !== ",") break;
        index++;
      }
      if (recursive)
        for (const { name } of definitions) ctes.add(scopeName(name));
      for (const { name, body } of definitions) {
        walk(body, ctes);
        ctes.add(scopeName(name));
      }
    }

    const first = keyword(tokens[index]);
    const query = ["select", "table", "values"].includes(first);
    const statement = joined || query;
    let inFrom = joined && !query;
    let relation = inFrom;
    for (; index < tokens.length; index++) {
      const token = tokens[index];
      if (!token) continue;
      const word = keyword(token);
      if (token.name === "Parens") {
        walk(token, ctes, relation);
        relation = false;
      } else if (statement) {
        const distinctFrom =
          word === "from" &&
          keyword(tokens[index - 1]) === "distinct" &&
          ["is", "not"].includes(keyword(tokens[index - 2]));
        if (
          token.name === "Keyword" &&
          !distinctFrom &&
          ["from", "join", "table"].includes(word)
        ) {
          inFrom = relation = true;
        } else if (token.name === "Keyword" && endFrom.has(word)) {
          inFrom = relation = false;
        } else if (inFrom && word === ",") {
          relation = true;
        } else if (relation && !["only", "lateral"].includes(word)) {
          if (tokens[index + 1]?.name !== "Parens") {
            const schema =
              token.name === "CompositeIdentifier" ? token.firstChild : null;
            const schemaName = identifier(schema ?? undefined);
            const name = identifier(
              schema ? (token.lastChild ?? undefined) : token,
            );
            if (
              name &&
              (!options.unqualifiedOnly || !name.includes(".")) &&
              (schema
                ? !options.unqualifiedOnly &&
                  ["public", "PUBLIC"].includes(schemaName ?? "")
                : !ctes.has(scopeName(name)))
            )
              tables.add(name);
          }
          relation = false;
        }
      }
    }
  }

  for (
    let node = parser.parse(source).topNode.firstChild;
    node;
    node = node.nextSibling
  )
    if (node.name === "Statement") walk(node, new Set());

  return tables;
}
