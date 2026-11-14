type TokenSpan = { start: number; end: number; raw: string };

export function protectHubLTokens(source: string, tokens: TokenSpan[]) {
  const reserved = new Set(source.match(/ANHUBL\d+TOKEN/g) ?? []);
  const originals = new Map<string, string>();
  const parts: string[] = [];
  let cursor = 0;
  let next = 0;
  for (const token of tokens) {
    let key: string;
    do key = `ANHUBL${next++}TOKEN`;
    while (reserved.has(key));
    parts.push(source.slice(cursor, token.start), key);
    originals.set(key, token.raw);
    cursor = token.end;
  }
  parts.push(source.slice(cursor));
  return {
    html: parts.join(""),
    restore(
      this: void,
      value: string,
      transform = (token: string) => token,
    ): string {
      return value.replace(/ANHUBL\d+TOKEN/g, (key) => {
        const token = originals.get(key);
        return token === undefined ? key : transform(token);
      });
    },
  };
}
