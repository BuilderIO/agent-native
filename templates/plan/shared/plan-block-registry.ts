import {
  BlockRegistry,
  registerBlocks,
  describeBlocksForAgent,
  renderBlockVocabularyReference,
  // The full React-free block library (checklist/table/code-tabs/html/tabs/
  // columns, the eight dev-doc blocks, plus callout/decision/question-form/
  // visual-questions/diagram/wireframe) is registered once via
  // `registerLibraryBlockConfigs` — the SAME shared list content's server
  // registry uses. Plan registers no app-only block configs of its own.
  registerLibraryBlockConfigs,
  type LibraryBlockConfigOverrides,
  type BlockAgentDoc,
} from "@agent-native/core/blocks/server";

/**
 * Server / shared plan block registry. Registers the React-free parts of each
 * block (schema + MDX config) so the MDX adapter (`plan-mdx.ts`) and agent schema
 * export can serialize/parse/describe blocks without importing React. The CLIENT
 * registry (`app/components/plan/planBlocks.tsx`) registers the same blocks WITH
 * their `Read`/`Edit` React components for rendering — both pull the identical
 * `mdx`/`schema` config from the shared core block library so source round-trip
 * stays consistent.
 *
 * `Read` is required on `BlockSpec`, so each server spec gets a render-only stub
 * (`() => null`) that is never invoked on the server. Unregistered block types
 * keep using the legacy `serializeBlock`/`parseBlock` path unchanged.
 */

/**
 * Plan's agent-facing overrides for the shared library config: the Mermaid
 * description is phrased for the plan's hand-drawn render style, and the file-tree
 * description carries the plan's detailed phrasing. Everything else (schema, MDX
 * config, labels, the `table` type, `notionCompatible` flags) uses the canonical
 * core value, so these configs live in exactly one place.
 */
const PLAN_SERVER_LIBRARY_OVERRIDES: LibraryBlockConfigOverrides = {
  mermaid: {
    description:
      "A Mermaid diagram for cases where textual sequence or flowchart grammar is clearer than a spatial layout; not the default for architecture maps.",
  },
  "file-tree": {
    description:
      "A VS Code / GitHub-explorer file and change tree derived from slash-delimited paths, with per-file change badges (added/modified/removed/renamed), notes, and code snippets.",
  },
};

export function registerPlanBlocks(registry: BlockRegistry): void {
  // Plan registers no app-only block configs; the full library (including
  // callout/decision/question-form/visual-questions/diagram/wireframe) is
  // registered once via `registerLibraryBlockConfigs` below.
  registerBlocks(registry, []);

  // The full standard library config (checklist/table/code-tabs/custom-html/tabs/
  // columns + the eight dev-doc blocks + callout/decision/question-form/
  // visual-questions/diagram/wireframe), shared with content's server registry.
  // Plan's only agent-facing tweaks: the Mermaid description is phrased for its
  // hand-drawn render style and the file-tree description is the detailed plan
  // phrasing. Table keeps the core default `type` (`table`). `notionCompatible`
  // on checklist/table comes from the shared config, so the single-sourced Notion
  // allowlist (`notion-compat.ts`) stays the same on server and client.
  registerLibraryBlockConfigs(registry, {
    overrides: PLAN_SERVER_LIBRARY_OVERRIDES,
  });
}

/**
 * A shared, React-free registry of every converted plan block, built once for
 * the agent-facing schema export. Uses the same `registerPlanBlocks` config the
 * MDX adapter uses, so the vocabulary the agent reads can never drift from what
 * the app serializes/renders.
 */
let cachedAgentRegistry: BlockRegistry | null = null;
function planAgentRegistry(): BlockRegistry {
  if (!cachedAgentRegistry) {
    cachedAgentRegistry = new BlockRegistry();
    registerPlanBlocks(cachedAgentRegistry);
  }
  return cachedAgentRegistry;
}

/**
 * The set of registered plan block `type`s that round-trip to Notion-Flavored
 * Markdown (the specs flagged `notionCompatible`). Single source for the Notion
 * gating allowlist — `notion-compat.ts` unions these with the prose-only NFM
 * analogs (`rich-text`, `callout`, `image`) that are not registry atoms. Reads
 * from the shared React-free registry so it is safe to call from server, agent,
 * and browser code alike.
 */
export function planNotionCompatibleBlockTypes(): Set<string> {
  return planAgentRegistry().notionCompatibleTypes();
}

/**
 * Structured per-block agent docs (type, label, placement, MDX tag, JSON schema,
 * example) for the registered plan blocks. Exposed to the agent so `/visual-plan`
 * generates only blocks the app can actually render and round-trip.
 */
export function describePlanBlocksForAgent(): BlockAgentDoc[] {
  return describeBlocksForAgent(planAgentRegistry());
}

/**
 * A compact markdown block-vocabulary reference for the plan agent, generated
 * from the live registry. Surfaced through the `get-plan-blocks` action and
 * referenced by the plan skills so the agent's block vocabulary stays accurate.
 */
export function renderPlanBlockVocabulary(): string {
  return renderBlockVocabularyReference(planAgentRegistry());
}
