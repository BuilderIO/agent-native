import {
  DESIGN_SCREEN_BLOCK_TYPE,
  DESIGN_SCREEN_TAG,
  readDesignScreenData,
  type DesignScreenData,
} from "./design-screen-block.js";
import { embedsInBody } from "./embeds-in-body.js";

export async function designScreensInBody(
  content: string | null | undefined,
): Promise<{ screens: DesignScreenData[]; unreadable: number }> {
  const { found, unreadable } = await embedsInBody(content, {
    tag: DESIGN_SCREEN_TAG,
    blockType: DESIGN_SCREEN_BLOCK_TYPE,
    read: readDesignScreenData,
  });
  return { screens: found, unreadable };
}
