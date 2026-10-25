// Shared by the CI change-scope classifier (which must run before install, so
// it imports only this dependency-free file) and scripts/mutation-changed.ts.

const MUTATION_SCOPE_PREFIX = "packages/core/src/";
const MUTATION_SCOPE_EXCLUDED_DIRS = [
  "packages/core/src/templates/",
  "packages/core/src/cli/",
] as const;

export function isMutationScopePath(path: string): boolean {
  if (!path.startsWith(MUTATION_SCOPE_PREFIX)) return false;
  if (!/\.(?:ts|tsx)$/u.test(path) || path.endsWith(".d.ts")) return false;
  const basename = path.slice(path.lastIndexOf("/") + 1);
  // `.typecheck.ts` files hold compile-time proofs that never run.
  if (/\.(?:spec|test|typecheck)\.[^/]+$/u.test(basename)) return false;
  return !MUTATION_SCOPE_EXCLUDED_DIRS.some((dir) => path.startsWith(dir));
}
