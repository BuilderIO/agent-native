/** Tokens shared by dependency discovery and the SQL template compiler. */
export type SqlTemplateToken =
  | { kind: "text"; text: string }
  | { kind: "single"; text: string }
  | {
      kind: "placeholder";
      text: string;
      name: string;
      filter?: "list" | "array" | "sql_literal" | undefined;
      quoted?: boolean;
    }
  | { kind: "blockStart"; text: string; name: string }
  | { kind: "blockEnd"; text: string; name: string }
  | { kind: "invalid"; text: string };

const placeholder =
  /^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)(?:(:list)|\s*\|\s*(array|sql_literal))?\s*\}\}/;
const block = /^\{\{([?/])([A-Za-z_][A-Za-z0-9_]*)\}\}/;

/** Scan SQL lexical regions before interpreting template syntax. */
export function scanSqlTemplate(source: string): SqlTemplateToken[] {
  const tokens: SqlTemplateToken[] = [];
  let i = 0;
  while (i < source.length) {
    const start = i;
    const char = source[i];
    if (char === "'" || char === '"' || char === "`") {
      const triple = char !== "`" && source.slice(i, i + 3) === char.repeat(3);
      const delimiter = char.repeat(triple ? 3 : 1);
      i += delimiter.length;
      let closed = false;
      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source.startsWith(delimiter, i)) {
          if (!triple && char === "'" && source[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += delimiter.length;
          closed = true;
          break;
        }
        i++;
      }
      const text = source.slice(start, i);
      const prefixed = /(?:^|[^A-Za-z0-9_])(?:r|b|rb|br)$/i.test(
        source.slice(Math.max(0, start - 3), start),
      );
      const match =
        closed && char === "'" && !triple && !prefixed
          ? text.slice(1, -1).match(placeholder)
          : null;
      if (
        match &&
        match[1] !== undefined &&
        match[0].length === text.length - 2 &&
        !match[2] &&
        !match[3]
      ) {
        tokens.push({
          kind: "placeholder",
          text,
          name: match[1],
          quoted: true,
        });
      } else {
        tokens.push({
          kind: char === "'" && !triple && !prefixed ? "single" : "text",
          text,
        });
      }
      continue;
    }
    if (
      source.startsWith("--", i) ||
      char === "#" ||
      source.startsWith("/*", i)
    ) {
      if (source.startsWith("/*", i)) {
        const end = source.indexOf("*/", i + 2);
        i = end < 0 ? source.length : end + 2;
      } else {
        const end = source.indexOf("\n", i);
        i = end < 0 ? source.length : end;
      }
      tokens.push({ kind: "text", text: source.slice(start, i) });
      continue;
    }
    if (source.startsWith("{{", i)) {
      const tail = source.slice(i);
      const b = tail.match(block);
      const p = tail.match(placeholder);
      if (b && b[2] !== undefined) {
        i += b[0].length;
        tokens.push({
          kind: b[1] === "?" ? "blockStart" : "blockEnd",
          text: b[0],
          name: b[2],
        });
      } else if (p && p[1] !== undefined) {
        i += p[0].length;
        tokens.push({
          kind: "placeholder",
          text: p[0],
          name: p[1],
          filter: p[2] ? "list" : (p[3] as "array" | "sql_literal" | undefined),
        });
      } else {
        i += 2;
        tokens.push({ kind: "invalid", text: "{{" });
      }
      continue;
    }
    if (source.startsWith("}}", i)) {
      i += 2;
      tokens.push({ kind: "invalid", text: "}}" });
      continue;
    }
    i++;
    tokens.push({ kind: "text", text: source.slice(start, i) });
  }
  return tokens;
}

/** Every input name a template reads, by the same grammar the compiler uses. */
export function sqlTemplateInputNames(template: string): string[] {
  const tokens = scanSqlTemplate(template);
  const names = new Set<string>();
  for (const token of tokens)
    if (token.kind === "blockStart") names.add(token.name);
  for (const token of tokens) {
    if (token.kind === "placeholder") names.add(token.name);
    if (token.kind === "single" && /\{\{|\}\}/.test(token.text)) {
      for (const match of token.text.matchAll(
        /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)(?:(:list)|\s*\|\s*(array|sql_literal))?\s*\}\}/g,
      )) {
        if (match[1] !== undefined) names.add(match[1]);
      }
    }
  }
  return [...names];
}
