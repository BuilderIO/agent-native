export interface SearchQueryTerm {
  text: string;
  phrase: boolean;
  negated: boolean;
  titleOnly: boolean;
}

export interface SearchQueryGroup {
  terms: SearchQueryTerm[];
}

export interface ParsedSearchQuery {
  groups: SearchQueryGroup[];
  negatives: SearchQueryTerm[];
  empty: boolean;
}

export function parseSearchQuery(input: string): ParsedSearchQuery {
  const groups: SearchQueryGroup[] = [];
  const negatives: SearchQueryTerm[] = [];
  let pendingOr = false;
  let i = 0;

  const pushTerm = (term: SearchQueryTerm) => {
    if (!/[\p{L}\p{N}]/u.test(term.text)) {
      pendingOr = false;
      return;
    }
    if (term.negated) {
      negatives.push(term);
      pendingOr = false;
      return;
    }
    if (pendingOr && groups.length > 0) {
      groups[groups.length - 1]!.terms.push(term);
    } else {
      groups.push({ terms: [term] });
    }
    pendingOr = false;
  };

  const trimmed = input.trim();
  const length = trimmed.length;
  while (i < length) {
    if (/\s/.test(trimmed[i]!)) {
      i += 1;
      continue;
    }
    let negated = false;
    if (trimmed[i] === "-" && trimmed[i + 1] && !/\s/.test(trimmed[i + 1]!)) {
      negated = true;
      i += 1;
    }
    let titleOnly = false;
    if (trimmed.startsWith("intitle:", i)) {
      titleOnly = true;
      i += "intitle:".length;
    }
    if (i >= length) break;
    if (trimmed[i] === '"') {
      const close = trimmed.indexOf('"', i + 1);
      const end = close === -1 ? length : close;
      const text = trimmed.slice(i + 1, end);
      i = close === -1 ? length : end + 1;
      if (text.trim())
        pushTerm({ text: text.trim(), phrase: true, negated, titleOnly });
      continue;
    }
    let j = i;
    while (j < length && !/\s/.test(trimmed[j]!)) j += 1;
    const text = trimmed.slice(i, j);
    i = j;
    if (!negated && !titleOnly && text === "OR" && groups.length > 0) {
      pendingOr = true;
      continue;
    }
    pushTerm({ text, phrase: false, negated, titleOnly });
  }

  return {
    groups,
    negatives,
    empty: groups.length === 0 && negatives.length === 0,
  };
}

export function searchQueryNeedles(parsed: ParsedSearchQuery): string[] {
  return parsed.groups.flatMap((group) => group.terms.map((term) => term.text));
}
