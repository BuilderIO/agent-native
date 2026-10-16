/**
 * The SQL with its `--`, `#` and block comments blanked, keeping quoted
 * text and line breaks; null when a block comment never closes.
 */
export function stripSqlComments(sql: string): string | null {
  const output: string[] = [];
  let quote: "'" | '"' | "`" | null = null;
  let blockComment = false;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]!;
    if (blockComment) {
      if (character === "*" && sql[index + 1] === "/") {
        blockComment = false;
        output.push(" ");
        index += 1;
      } else if (character === "\n") {
        output.push("\n");
      }
      continue;
    }
    if (quote) {
      output.push(character);
      if (character === quote) {
        if (sql[index + 1] === quote) {
          output.push(sql[index + 1]!);
          index += 1;
        } else {
          quote = null;
        }
      } else if (character === "\\") {
        if (sql[index + 1] !== undefined) {
          output.push(sql[index + 1]!);
          index += 1;
        }
      }
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      output.push(character);
    } else if (character === "-" && sql[index + 1] === "-") {
      while (index < sql.length && sql[index] !== "\n") index += 1;
      if (sql[index] === "\n") output.push("\n");
    } else if (character === "#") {
      while (index < sql.length && sql[index] !== "\n") index += 1;
      if (sql[index] === "\n") output.push("\n");
    } else if (character === "/" && sql[index + 1] === "*") {
      blockComment = true;
      output.push(" ");
      index += 1;
    } else {
      output.push(character);
    }
  }
  return blockComment ? null : output.join("");
}
