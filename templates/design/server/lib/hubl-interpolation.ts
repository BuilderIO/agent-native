const LITERAL = String.raw`('(?:[^'\\]|\\['"\\ntbfr])*'|"(?:[^"\\]|\\['"\\ntbfr])*")`;
const LITERAL_ESCAPES: Record<string, string> = {
  "'": "'",
  '"': '"',
  "\\": "\\",
  n: "\n",
  t: "\t",
  b: "\b",
  f: "\f",
  r: "\r",
};
const DEFAULT_FILTER = new RegExp(
  `^\\s*\\|\\s*default\\s*\\(\\s*${LITERAL}(?:\\s*,\\s*(?:true|false))?\\s*\\)`,
);
const PERSONALIZATION = new RegExp(
  `^personalization_token\\s*\\(\\s*(['"])(contact\\.[\\w.]+)\\1\\s*,\\s*${LITERAL}\\s*\\)`,
);

function literalValue(literal: string): string {
  return literal
    .slice(1, -1)
    .replace(
      /\\(['"\\ntbfr])/g,
      (_, escape: string) => LITERAL_ESCAPES[escape],
    );
}

export function parseHubLInterpolation(token: string):
  | {
      name: string;
      fallback?: string;
      personalization: boolean;
      filtered: boolean;
    }
  | undefined {
  const expression = token.match(/^{{\s*([\s\S]*?)\s*}}$/)?.[1];
  if (!expression) return undefined;
  const personalization = expression.match(PERSONALIZATION);
  const variable = expression.match(/^([\w.]+)([\s\S]*)$/);
  let rest = personalization
    ? expression.slice(personalization[0].length)
    : variable?.[2];
  if (rest === undefined) return undefined;
  const filtered = !!rest.trim();
  let fallback = personalization ? literalValue(personalization[3]) : undefined;
  while (rest.trim()) {
    const defaultFilter = rest.match(DEFAULT_FILTER);
    const filter = rest.match(
      /^\s*\|\s*(?:escape_html|escape_attr|escape_url|escape|urlencode)\b/,
    );
    const matched = defaultFilter ?? filter;
    if (!matched) return undefined;
    if (defaultFilter && fallback === undefined)
      fallback = literalValue(defaultFilter[1]);
    rest = rest.slice(matched[0].length);
  }
  return {
    name: personalization ? personalization[2] : variable![1],
    ...(fallback === undefined ? {} : { fallback }),
    personalization: !!personalization,
    filtered,
  };
}
