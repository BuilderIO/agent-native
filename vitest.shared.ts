/**
 * Monorepo-only re-export of the shared vitest base config.
 *
 * Packages under `packages/` use this path because they must not take a
 * dependency on core. Templates and examples import
 * `@agent-native/core/vitest-config` directly instead: a template directory is
 * scaffolded out verbatim as a standalone app, so a config that reaches above
 * the template would resolve to nothing once it ships.
 */
export { default, resolveMaxWorkers } from "./packages/core/src/vitest-config";
