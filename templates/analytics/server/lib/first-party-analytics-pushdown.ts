import { lexAgentSql, type AgentSqlToken } from "@agent-native/core/agent-sql";

const CONSTANT_WORDS = new Set([
  "date",
  "timestamp",
  "cast",
  "as",
  "string",
  "interval",
  "day",
  "week",
  "month",
  "year",
  "current_date",
  "current_timestamp",
  "date_sub",
  "date_add",
  "timestamp_sub",
  "timestamp_add",
  "null",
]);

function safePredicate(tokens: AgentSqlToken[], alias: string): string | null {
  while (tokens[0]?.text === "(" && tokens[tokens.length - 1]?.text === ")") {
    let depth = 0;
    const encloses = tokens.every((token, index) => {
      if (token.text === "(") depth++;
      if (token.text === ")") depth--;
      return depth > 0 || index === tokens.length - 1;
    });
    if (!encloses) break;
    tokens = tokens.slice(1, -1);
  }
  let offset = 0;
  if (tokens[1]?.text === ".") {
    if (tokens[0].value.toLowerCase() !== alias.toLowerCase()) return null;
    offset = 2;
  }
  const column = tokens[offset]?.value.toLowerCase();
  const operator = tokens[offset + 1]?.value.toLowerCase();
  if (column !== "event_date" && column !== "event_name") return null;
  if (
    !(column === "event_date"
      ? ["=", ">", ">=", "<", "<=", "between"].includes(operator)
      : ["=", "in"].includes(operator))
  )
    return null;
  const rhs = tokens.slice(offset + 2);
  if (
    !rhs.length ||
    rhs.some(
      (token, index) =>
        token.kind === "parameter" ||
        token.kind === "quoted-identifier" ||
        (token.kind === "word" &&
          ["timestamp", "date", "string"].includes(token.value) &&
          !(
            rhs[index + 1]?.text === "(" ||
            rhs[index + 1]?.kind === "string" ||
            rhs[index - 1]?.value === "as"
          )) ||
        (token.kind === "word" &&
          !CONSTANT_WORDS.has(token.value) &&
          !(operator === "between" && token.value === "and")) ||
        (token.kind === "punctuation" &&
          !["(", ")", ","].includes(token.text)) ||
        (token.kind === "operator" && !["+", "-"].includes(token.text)),
    )
  )
    return null;
  return [column, ...tokens.slice(offset + 1).map((token) => token.text)].join(
    " ",
  );
}

// Only immutable delivery fields commute with latest-receipt deduplication.
// Payload, identity and timestamp filters must remain outside it.
export function firstPartyEventPushdownPredicates(
  sql: string,
  sourceIndex: number,
  { allowDirectSource = false }: { allowDirectSource?: boolean } = {},
): string[] {
  const tokens = lexAgentSql(sql, { dialect: "bigquery" });
  const depths: number[] = [];
  const stack: number[] = [];
  const pairs = new Map<number, number>();
  let wrapper: number | undefined;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.start <= sourceIndex && token.end > sourceIndex)
      wrapper = stack[stack.length - 1];
    depths[index] = stack.length;
    if (token.text === "(") stack.push(index);
    if (token.text === ")") {
      const open = stack.pop();
      if (open !== undefined) pairs.set(open, index);
    }
  }
  let alias: AgentSqlToken | undefined;
  let depth: number | undefined;
  let where: number | undefined;
  if (wrapper !== undefined && tokens[wrapper - 1]?.value === "from") {
    const close = pairs.get(wrapper);
    if (close === undefined) return [];
    let aliasIndex = close + 1;
    if (tokens[aliasIndex]?.value === "as") aliasIndex++;
    alias = tokens[aliasIndex];
    if (!alias || !["word", "quoted-identifier"].includes(alias.kind))
      return [];
    depth = depths[wrapper];
    let select = wrapper - 2;
    while (
      select >= 0 &&
      !(depths[select] === depth && tokens[select].value === "select")
    )
      select--;
    if (select < 0) return [];
    // A preceding FROM means this derived source belongs to a join/comma list.
    if (
      tokens
        .slice(select, wrapper - 1)
        .some(
          (token, index) =>
            depths[select + index] === depth && token.value === "from",
        )
    )
      return [];
    where = aliasIndex + 1;
  } else {
    if (!allowDirectSource) return [];
    const sourceTokenIndex = tokens.findIndex(
      (token) => token.start <= sourceIndex && token.end > sourceIndex,
    );
    if (sourceTokenIndex < 0) return [];
    depth = depths[sourceTokenIndex];
    let select = sourceTokenIndex - 1;
    while (
      select >= 0 &&
      !(depths[select] === depth && tokens[select].value === "select")
    )
      select--;
    if (select < 0) return [];
    const source = tokens[sourceTokenIndex];
    let aliasIndex = sourceTokenIndex + 1;
    if (tokens[aliasIndex]?.value === "as") aliasIndex++;
    const aliasCandidate = tokens[aliasIndex];
    const reserved = new Set([
      "where",
      "join",
      "left",
      "right",
      "inner",
      "outer",
      "cross",
      "full",
      "group",
      "having",
      "qualify",
      "order",
      "limit",
      "union",
      "except",
      "intersect",
      "window",
    ]);
    alias =
      aliasCandidate &&
      ["word", "quoted-identifier"].includes(aliasCandidate.kind) &&
      !reserved.has(aliasCandidate.value.toLowerCase())
        ? aliasCandidate
        : source;
    where = sourceTokenIndex + 1;
    while (
      where < tokens.length &&
      !(depths[where] === depth && tokens[where].value === "where")
    ) {
      if (
        depths[where] < depth ||
        (depths[where] === depth &&
          ["group", "having", "qualify", "order", "limit", "union"].includes(
            tokens[where].value,
          ))
      )
        return [];
      where++;
    }
  }
  if (
    where === undefined ||
    tokens[where]?.value !== "where" ||
    depths[where] !== depth
  )
    return [];
  const sourceAlias = alias?.value;
  if (!sourceAlias) return [];
  const predicates: AgentSqlToken[][] = [[]];
  let between = false;
  for (let index = where + 1; index < tokens.length; index++) {
    const token = tokens[index];
    if (
      depths[index] < depth ||
      (depths[index] === depth && token.text === ")") ||
      (depths[index] === depth &&
        token.kind === "word" &&
        [
          "group",
          "having",
          "qualify",
          "order",
          "limit",
          "union",
          "except",
          "intersect",
          "window",
        ].includes(token.value))
    )
      break;
    if (
      depths[index] === depth &&
      token.kind === "word" &&
      token.value === "or"
    )
      return [];
    if (
      depths[index] === depth &&
      token.kind === "word" &&
      token.value === "between"
    )
      between = true;
    if (
      depths[index] === depth &&
      token.kind === "word" &&
      token.value === "and"
    ) {
      if (between) between = false;
      else {
        predicates.push([]);
        continue;
      }
    }
    predicates[predicates.length - 1].push(token);
  }
  return predicates.flatMap((predicate) => {
    const safe = safePredicate(predicate, sourceAlias);
    return safe === null ? [] : [safe];
  });
}
