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
import { designScreenErrorMessage } from "./design-screen-errors";

export type DesignScreenPasteContext = SourceLinkPasteContext;
export type DesignScreenPasteOptions = SourceLinkPasteOptions;

type CaptureResult =
  | { status: "captured"; blockId: string; screen: DesignScreenData }
  | {
      status: "needs_confirmation";
      blockId: string;
      design: { title: string };
    };

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
  describeError: designScreenErrorMessage,
  messages: {
    adding: "designScreen.adding",
    added: "designScreen.added",
    addFailed: "designScreen.addFailed",
    addAnyway: "designScreen.addAnyway",
    keepLink: "designScreen.keepLink",
  },
});
