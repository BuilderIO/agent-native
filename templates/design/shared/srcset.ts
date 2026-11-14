export interface SrcsetCandidate {
  url: string;
  descriptor: string;
}

export function parseSrcset(value: string): SrcsetCandidate[] {
  const candidates: SrcsetCandidate[] = [];
  let position = 0;

  while (position < value.length) {
    while (position < value.length && /[\s,]/.test(value[position]!))
      position += 1;
    if (position >= value.length) break;

    const urlStart = position;
    while (position < value.length && !/\s/.test(value[position]!))
      position += 1;
    let url = value.slice(urlStart, position);
    const hasTrailingSeparator = url.endsWith(",");
    while (url.endsWith(",")) url = url.slice(0, -1);

    let descriptor = "";
    if (!hasTrailingSeparator) {
      while (position < value.length && /\s/.test(value[position]!))
        position += 1;
      const descriptorStart = position;
      let parentheses = 0;
      while (position < value.length) {
        const character = value[position]!;
        if (character === "(") parentheses += 1;
        if (character === ")" && parentheses > 0) parentheses -= 1;
        if (character === "," && parentheses === 0) break;
        position += 1;
      }
      descriptor = value.slice(descriptorStart, position).trim();
      if (value[position] === ",") position += 1;
    }

    if (url) candidates.push({ url, descriptor });
  }

  return candidates;
}
