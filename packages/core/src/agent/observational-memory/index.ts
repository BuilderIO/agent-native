/**
 * Observational Memory (OM) — background compaction of a long agent thread into
 * a dated, three-tier context (recent raw messages → dense observations →
 * higher-level reflections) so long-running threads cost far fewer tokens and
 * stay prompt-cache stable.
 *
 * Public surface:
 * - `buildObservationalContext` — read API returning the three tiers ready for
 *   prompt injection. NOT yet wired into production-agent.ts (see the
 *   TODO(charlie-merge) seam in `read.ts`).
 * - `maybeCompactThread` — decoupled compactor the agent loop can call after a
 *   turn; runs the Observer then the Reflector. Wired later, not now.
 * - `runObserver` / `runReflector` — the individual compaction passes.
 * - store helpers + the migration plugin factory.
 */

export {
  resolveObservationalMemoryConfig,
  DEFAULT_OBSERVATION_TOKEN_THRESHOLD,
  DEFAULT_REFLECTION_TOKEN_THRESHOLD,
  DEFAULT_RECENT_RAW_MESSAGE_COUNT,
  DEFAULT_OBSERVATION_MAX_OUTPUT_TOKENS,
  DEFAULT_REFLECTION_MAX_OUTPUT_TOKENS,
  type ObservationalMemoryConfig,
} from "./config.js";

export {
  insertObservationalMemory,
  listObservationalMemory,
  getObservedThroughIndex,
  getObservationLogTokens,
  __resetObservationalMemoryTableCache,
  type InsertObservationalMemoryInput,
  type ListObservationalMemoryOptions,
} from "./store.js";

export {
  runInternalAgentCall,
  type InternalAgentRunOptions,
  type InternalAgentRunFn,
} from "./internal-run.js";

export {
  runObserver,
  type RunObserverOptions,
  type RunObserverResult,
} from "./observer.js";
export {
  runReflector,
  type RunReflectorOptions,
  type RunReflectorResult,
} from "./reflector.js";

export {
  maybeCompactThread,
  type MaybeCompactThreadOptions,
  type MaybeCompactThreadResult,
} from "./compactor.js";

export {
  buildObservationalContext,
  hasObservationalMemory,
  serializeObservationalMemoryBlock,
  type BuildObservationalContextOptions,
} from "./read.js";

export {
  createObservationalMemoryPlugin,
  defaultObservationalMemoryPlugin,
} from "./plugin.js";

export { OBSERVATIONAL_MEMORY_MIGRATIONS } from "./migrations.js";

export type {
  ObservationalMemoryTier,
  ObservationalMemoryEntry,
  ObservationalMemoryOwner,
  ObservationalContext,
} from "./types.js";
