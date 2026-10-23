/**
 * Points this process at a throwaway PGlite database and nothing else. The
 * client resolvers prefer `<APP>_DATABASE_URL`, `NETLIFY_DATABASE_URL` and the
 * `_UNPOOLED` variants over `DATABASE_URL`, so setting only `DATABASE_URL`
 * would let a shell or `.env` value send release migrations to a real
 * database. Call before importing core; call `assertIsolatedPglite` after.
 */
export function useIsolatedPglite(dataDir: string): string {
  const url = `pglite:${dataDir}`;
  for (const key of Object.keys(process.env)) {
    if (key.includes("DATABASE_URL")) delete process.env[key];
  }
  process.env.DATABASE_URL = url;
  return url;
}

export function assertIsolatedPglite(
  url: string,
  resolvers: Record<string, () => string>,
): void {
  const stray = Object.entries(resolvers)
    .map(([name, resolve]) => [name, resolve()] as const)
    .filter(([, resolved]) => resolved !== url);
  if (stray.length > 0) {
    throw new Error(
      `Refusing to run: expected every database resolver to return ${url}, got ${stray
        .map(([name, resolved]) => `${name} = ${resolved || "(empty)"}`)
        .join(", ")}.`,
    );
  }
}
