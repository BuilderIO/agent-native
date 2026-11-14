type HubLToken = { start: number; end: number; raw: string };

function scanTokens(
  content: string,
  includeControlTags: boolean,
): {
  tokens: HubLToken[];
  unclosedAt?: number;
} {
  const tokens: HubLToken[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    const next = content[cursor + 1];
    if (
      content[cursor] !== "{" ||
      (next !== "{" && !(includeControlTags && next === "%"))
    ) {
      cursor += 1;
      continue;
    }
    const closing = next === "%" ? "%" : "}";
    const start = cursor;
    cursor += 2;
    let quote: string | undefined;
    let end: number | undefined;
    while (cursor < content.length) {
      const character = content[cursor];
      if (quote) {
        if (character === "\\") {
          cursor += 2;
          continue;
        }
        if (character === quote) quote = undefined;
      } else if (character === "'" || character === '"') {
        quote = character;
      } else if (character === closing && content[cursor + 1] === "}") {
        end = cursor + 2;
        break;
      }
      cursor += 1;
    }
    if (end === undefined) return { tokens, unclosedAt: start };
    tokens.push({ start, end, raw: content.slice(start, end) });
    cursor = end;
  }
  return { tokens };
}

export function scanHubLInterpolations(content: string) {
  return scanTokens(content, false);
}

export function scanHubLTemplateTokens(content: string) {
  return scanTokens(content, true);
}
