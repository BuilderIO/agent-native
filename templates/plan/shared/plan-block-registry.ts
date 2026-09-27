import {
  BlockRegistry,
  registerBlocks,
  describeBlocksForAgent,
  renderBlockVocabularyReference,
  registerLibraryBlockConfigs,
  type LibraryBlockConfigOverrides,
  type BlockAgentDoc,
} from "@agent-native/core/blocks/server";

const PLAN_SERVER_LIBRARY_OVERRIDES: LibraryBlockConfigOverrides = {
  mermaid: {
    description:
      "A Mermaid diagram for cases where textual sequence or flowchart grammar is clearer than a spatial layout; not the default for architecture maps.",
  },
  "file-tree": {
    description:
      "A VS Code / GitHub-explorer file and change tree derived from slash-delimited paths, with per-file change badges (added/modified/removed/renamed), notes, and code snippets.",
  },
  "code-tabs": {
    description:
      "A vertical file tab rail of syntax-highlighted code snippets, one tab per file. Deprecated: prefer a `tabs` block with `code` children.",
  },
  "visual-questions": {
    description:
      "A visual-intake question block with the same editable question/option shape as question-form. Deprecated: prefer `question-form`.",
  },
};

export function registerPlanBlocks(registry: BlockRegistry): void {
  registerBlocks(registry, []);

  registerLibraryBlockConfigs(registry, {
    overrides: PLAN_SERVER_LIBRARY_OVERRIDES,
  });
}

let cachedAgentRegistry: BlockRegistry | null = null;
function planAgentRegistry(): BlockRegistry {
  if (!cachedAgentRegistry) {
    cachedAgentRegistry = new BlockRegistry();
    registerPlanBlocks(cachedAgentRegistry);
  }
  return cachedAgentRegistry;
}

export function planNotionCompatibleBlockTypes(): Set<string> {
  return planAgentRegistry().notionCompatibleTypes();
}

export function describePlanBlocksForAgent(): BlockAgentDoc[] {
  return describeBlocksForAgent(planAgentRegistry());
}

export function renderPlanBlockVocabulary(): string {
  return renderBlockVocabularyReference(planAgentRegistry());
}
