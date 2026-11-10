import { BlockRegistry } from "@agent-native/core/blocks/server";

import { clipEmbedBlock } from "@/components/editor/clip-embed/ClipEmbedBlock";

/**
 * Blocks a public page renders for a signed-out reader. Only blocks whose
 * reads work without a session belong here; the rest keep their fallback.
 */
export const publicContentBlockRegistry = new BlockRegistry();

publicContentBlockRegistry.register(clipEmbedBlock);
