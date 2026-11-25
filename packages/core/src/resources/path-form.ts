/**
 * A resource path's stored form: no leading "/". Uploads used to store
 * "/notes.md" beside a created "notes.md", so rows in that older form still
 * exist. Every write stores this form, and every lookup also matches the
 * other one.
 */
export function canonicalResourcePath(path: string): string {
  return path.replace(/^\/+/, "");
}

/**
 * The two stored spellings of one resource path, the one asked for first.
 * Where a name is stored in both forms, each spelling reaches its own row,
 * and a path with no leading "/" reaches the canonical one.
 */
export function resourcePathForms(path: string): [string, string] {
  const canonical = canonicalResourcePath(path);
  const slashed = `/${canonical}`;
  return path === slashed ? [slashed, canonical] : [canonical, slashed];
}
