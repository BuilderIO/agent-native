import { callAction } from "@agent-native/core/client/hooks";
import { parseDesignScreenLink } from "@agent-native/core/shared";
import {
  DESIGN_SCREEN_BLOCK_TYPE,
  designScreenBlockRaw,
  type DesignScreenData,
} from "@shared/design-screen-block";

import {
  createSourceLinkPaste,
  type SourceLinkPasteContext,
  type SourceLinkPasteOptions,
} from "../source-link-paste";

export type DesignScreenPasteContext = SourceLinkPasteContext;
export type DesignScreenPasteOptions = SourceLinkPasteOptions;

type CaptureResult =
  | { status: "captured"; blockId: string; screen: DesignScreenData }
  | {
      status: "needs_confirmation";
      blockId: string;
      design: { title: string };
    };

/**
 * The screen a paste names, when it is exactly one Design screen link. A
 * link to a whole board stays a link: only one screen can be pinned.
 */
export function designScreenLinkFromPaste(
  text: string,
  origins: readonly string[],
): { designId: string; screenId: string } | null {
  if (origins.length === 0) return null;
  const link = parseDesignScreenLink(text, origins);
  return link?.kind === "screen"
    ? { designId: link.designId, screenId: link.screenId }
    : null;
}

/**
 * Pasting a Design screen link (Copy link on a screen) into a page an editor
 * can change pastes the link as usual, then asks Design for a picture of the
 * screen as that editor and swaps the link for the pinned screen. If Design
 * refuses, the link stays.
 */
export const DesignScreenPaste = createSourceLinkPaste<{
  designId: string;
  screenId: string;
}>({
  name: "designScreenPaste",
  blockType: DESIGN_SCREEN_BLOCK_TYPE,
  parse: designScreenLinkFromPaste,
  capture: async ({ documentId, t }, request, acknowledgeWiderAudience) => {
    const result = (await callAction("capture-design-screen", {
      documentId,
      ...request,
      purpose: "insert",
      ...(acknowledgeWiderAudience ? { acknowledgeWiderAudience } : {}),
    })) as CaptureResult;
    return result.status === "needs_confirmation"
      ? {
          status: "needs_confirmation",
          message: t("designScreen.confirmWider", {
            design: result.design.title,
          }),
        }
      : {
          status: "captured",
          blockId: result.blockId,
          raw: designScreenBlockRaw(result.blockId, result.screen),
        };
  },
  messages: {
    adding: "designScreen.adding",
    added: "designScreen.added",
    addFailed: "designScreen.addFailed",
    addAnyway: "designScreen.addAnyway",
    keepLink: "designScreen.keepLink",
  },
});
