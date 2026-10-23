type HubLInterpolationToken = { start: number; end: number; raw: string };

export function scanHubLInterpolations(content: string): {
  tokens: HubLInterpolationToken[];
  unclosedAt?: number;
} {
  const tokens: HubLInterpolationToken[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    if (content[cursor] !== "{" || content[cursor + 1] !== "{") {
      cursor += 1;
      continue;
    }
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
      } else if (character === "}" && content[cursor + 1] === "}") {
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
