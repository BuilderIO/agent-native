const CODE_FILE = String.raw`(?:[cm]?[jt]s|[jt]sx)`;

/** `*.spec.*` and `*.test.*`, or any script under `__tests__/`, `e2e/`, `tests/` or `test/`. */
const TEST_FILE = new RegExp(
  String.raw`(?:\.(?:spec|test)\.${CODE_FILE}$|(?:^|/)(?:__tests__|e2e|tests?)/.+\.${CODE_FILE}$)`,
);

/** Documentation, changesets, lockfiles, package manifests and configuration: nothing a test would run. */
const EXEMPT_FILE = new RegExp(
  [
    String.raw`\.mdx?$`,
    String.raw`(?:^|/)\.changeset/`,
    String.raw`(?:^|/)(?:pnpm-lock\.yaml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|bun\.lockb?)$`,
    String.raw`(?:^|/)package\.json$`,
    String.raw`(?:^|/)pnpm-workspace\.yaml$`,
    String.raw`(?:^|/)tsconfig[^/]*\.json$`,
    String.raw`\.config\.${CODE_FILE}$`,
    String.raw`\.(?:ya?ml|toml)$`,
    String.raw`^\.[^/]+$`,
    String.raw`^\.github/`,
  ].join("|"),
);

const normalized = (file: string) => file.toLowerCase();

export function isTestFile(file: string): boolean {
  return TEST_FILE.test(normalized(file));
}

/** A change to this file has no test to add: it is not code, or it is a dependency or config change. */
export function isExemptFromRegressionTest(file: string): boolean {
  return EXEMPT_FILE.test(normalized(file));
}

/** The changed files that are code: neither a test nor exempt. */
export function codeFilesWithoutTest(files: readonly string[]): string[] {
  return files.some(isTestFile)
    ? []
    : files.filter((file) => !isExemptFromRegressionTest(file));
}
