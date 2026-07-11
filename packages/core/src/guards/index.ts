/**
 * `agent-native doctor`'s guard functions — the source-code safety
 * invariants ported from this monorepo's `scripts/guard-*.mjs` CI guards
 * (see report `advisor-plans/reports/005-doctor-design.md` for the
 * classification and per-guard parameterization). Each guard is a pure,
 * synchronous function that scans an app root and returns a `GuardResult`.
 *
 * `../cli/doctor.ts` is the only in-package caller; this module is also
 * published under the `./guards` export subpath for advanced/CI use
 * outside the CLI.
 */

export { scanDbToolScoping } from "./db-tool-scoping.js";
export type { DbToolScopingOptions } from "./db-tool-scoping.js";
export { scanDrizzlePush } from "./no-drizzle-push.js";
export { scanEnvCredentials } from "./no-env-credentials.js";
export { scanEnvMutation } from "./no-env-mutation.js";
export { scanLocalhostFallback } from "./no-localhost-fallback.js";
export type { LocalhostFallbackOptions } from "./no-localhost-fallback.js";
export { scanUnscopedCredentials } from "./no-unscoped-credentials.js";
export { scanUnscopedQueries } from "./no-unscoped-queries.js";
export type { UnscopedQueriesOptions } from "./no-unscoped-queries.js";
export type { GuardFinding, GuardResult, GuardScanOptions } from "./types.js";
