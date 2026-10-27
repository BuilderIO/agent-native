import {
  CLIP_EMBED_BLOCK_TYPE,
  clipEmbedBlockRaw,
  type ClipEmbedOrigin,
} from "@shared/clip-embed-block";

import { createContentBlockId } from "../extensions/registryBlocks";

/** A new Clip block, as editor content, with an id of its own. */
export function clipEmbedBlockContent(
  recordingId: string,
  origin: ClipEmbedOrigin,
) {
  const blockId = createContentBlockId(CLIP_EMBED_BLOCK_TYPE);
  return {
    type: "registryBlock",
    attrs: {
      blockType: CLIP_EMBED_BLOCK_TYPE,
      blockId,
      title: null,
      summary: null,
      __raw: clipEmbedBlockRaw(blockId, { recordingId, origin }),
    },
  };
}
