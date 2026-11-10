import {
  CLIP_EMBED_BLOCK_TYPE,
  clipEmbedBlockRaw,
  type ClipEmbedOrigin,
} from "@shared/clip-embed-block";

import { createContentBlockId } from "../extensions/registryBlocks";

/**
 * A new Clip block, as editor content. It gets an id of its own unless Clips
 * already bound the Clip to one.
 */
export function clipEmbedBlockContent(
  recordingId: string,
  origin: ClipEmbedOrigin,
  blockId: string = createContentBlockId(CLIP_EMBED_BLOCK_TYPE),
) {
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
