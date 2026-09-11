function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

export function buildCaseInsensitiveSearchPattern(query: string): string {
  return `%${escapeLike(query.toLowerCase())}%`;
}
