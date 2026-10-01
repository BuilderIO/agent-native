import type { AgentSqlToken } from "./lexer.js";

function isName(token: AgentSqlToken | undefined): token is AgentSqlToken {
  return token?.kind === "word" || token?.kind === "quoted-identifier";
}

function isPunctuation(token: AgentSqlToken | undefined, text: string) {
  return token?.kind === "punctuation" && token.text === text;
}

/**
 * Splits tokens into statements on `;`. A trailing `;` does not start a new
 * statement, so `SELECT 1;` is one statement.
 */
export function splitAgentSqlStatements(
  tokens: AgentSqlToken[],
): AgentSqlToken[][] {
  const statements: AgentSqlToken[][] = [];
  let current: AgentSqlToken[] = [];
  for (const token of tokens) {
    if (isPunctuation(token, ";")) {
      if (current.length > 0) statements.push(current);
      current = [];
      continue;
    }
    current.push(token);
  }
  if (current.length > 0) statements.push(current);
  return statements;
}

/** The first keyword of a statement, ignoring leading parentheses. */
export function leadingAgentSqlKeyword(tokens: AgentSqlToken[]): string | null {
  for (const token of tokens) {
    if (isPunctuation(token, "(")) continue;
    return token.kind === "word" ? token.value : null;
  }
  return null;
}

export interface AgentSqlQualifiedReference {
  /** Every name before the last dot, as the database resolves them. */
  qualifiers: string[];
  name: string;
  /** Index of the first token of the reference. */
  index: number;
}

/**
 * Every dotted name chain, such as `a.b` or `a.b.c`. The lexer has already
 * removed comments and whitespace, so spacing or comments around the dot do
 * not hide a chain. Column references (`alias.column`) are included; callers
 * decide which qualifiers matter.
 */
export function agentSqlQualifiedReferences(
  tokens: AgentSqlToken[],
): AgentSqlQualifiedReference[] {
  const references: AgentSqlQualifiedReference[] = [];
  for (let index = 0; index < tokens.length; index++) {
    if (!isName(tokens[index])) continue;
    // Start only at the head of a chain.
    if (index > 0 && isPunctuation(tokens[index - 1], ".")) continue;
    const parts = [tokens[index].value];
    let cursor = index;
    while (
      isPunctuation(tokens[cursor + 1], ".") &&
      (isName(tokens[cursor + 2]) ||
        (tokens[cursor + 2]?.kind === "operator" &&
          tokens[cursor + 2].text === "*"))
    ) {
      parts.push(tokens[cursor + 2].value);
      cursor += 2;
    }
    if (parts.length > 1) {
      references.push({
        qualifiers: parts.slice(0, -1),
        name: parts[parts.length - 1],
        index,
      });
    }
  }
  return references;
}

/** Names immediately followed by `(`, i.e. function calls and type modifiers. */
export function agentSqlCalledNames(tokens: AgentSqlToken[]): string[] {
  const names: string[] = [];
  for (let index = 0; index < tokens.length - 1; index++) {
    if (isName(tokens[index]) && isPunctuation(tokens[index + 1], "(")) {
      names.push(tokens[index].value);
    }
  }
  return names;
}

/** Every unquoted and quoted identifier value in the statement. */
export function agentSqlIdentifierNames(tokens: AgentSqlToken[]): Set<string> {
  const names = new Set<string>();
  for (const token of tokens) {
    if (isName(token)) names.add(token.value);
  }
  return names;
}
