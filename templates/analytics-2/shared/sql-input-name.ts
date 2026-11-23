const RESERVED_NAMES = new Set(
  (
    "False None True and as assert async await break class continue def del " +
    "elif else except finally for from global if import in is lambda " +
    "nonlocal not or pass raise return try while with yield"
  ).split(" "),
);

export function isSqlInputName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !RESERVED_NAMES.has(name);
}

export const sqlTemplateBlock =
  /\{\{\?([A-Za-z_][A-Za-z0-9_]*)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
export const sqlTemplateParameter =
  /'\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}'|\{\{\s*([A-Za-z_][A-Za-z0-9_]*)(?:(:list|\s*\|\s*array)|\s*\|\s*sql_literal)?\s*\}\}/g;

export function sqlInputReferences(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(sqlTemplateBlock)) {
    if (match[1]) names.add(match[1]);
  }
  for (const match of source.matchAll(sqlTemplateParameter)) {
    const name = match[1] ?? match[2];
    if (name) names.add(name);
  }
  return names;
}
