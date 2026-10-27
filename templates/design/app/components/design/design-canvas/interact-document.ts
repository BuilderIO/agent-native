import { injectSessionReplayIframeBootstrap } from "@agent-native/core/client/host";
import { injectDocumentMarkup } from "@agent-native/core/shared";

import { interactLinksBridgeScript } from "../../../../.generated/bridge/interact-links.generated";
import type { ScreenHeightMode } from "../multi-screen/screen-height";
import { contentSizeReportBridge } from "./content-size-report";
import {
  embeddedContentOffsetStyle,
  getEmbeddedFrameBackgroundStyle,
  getEmbeddedFrameDocumentContent,
} from "./embedded-frame";
import { withLocalRuntimes } from "./local-runtime";
import { PREVIEW_THEME_BRIDGE_SCRIPT } from "./preview-theme";

const INTERACT_LINKS_BRIDGE_SCRIPT = `<script data-agent-native-interact-links-bridge>${interactLinksBridgeScript}</script>`;

/**
 * What an Interact markup preview adds to the design: the theme bridge, which
 * the Light / Dark picker drives, and the links bridge, which makes a link to
 * another screen switch screens. Nothing here listens for scrolling, dragging,
 * keys or pointer input, so the page runs as it would in a tab. Explicit Hug
 * previews also report dimensions so their host can fit the authored content.
 */
const INTERACT_PREVIEW_BRIDGES =
  PREVIEW_THEME_BRIDGE_SCRIPT + INTERACT_LINKS_BRIDGE_SCRIPT;

/**
 * The document an Interact preview loads. It is the design as the editor
 * frames it (local Alpine and Tailwind, the runtimes the design embeds, the
 * frame's fit, background and offset) with only the two bridges above on top.
 * Edit builds its document separately and keeps every editor bridge.
 */
export function buildInteractPreviewDocument(args: {
  content: string;
  embeddedFrameBackground?: string;
  transparentBackground?: boolean;
  contentOffsetX?: number;
  contentOffsetY?: number;
  fitBodyToFrame: boolean;
  heightMode?: ScreenHeightMode;
}): string {
  const localizedContent = withLocalRuntimes(args.content);
  const frameContent = getEmbeddedFrameDocumentContent({
    content: localizedContent,
    embeddedFrameBackground: args.embeddedFrameBackground,
    transparentBackground: args.transparentBackground,
    contentOffsetX: args.contentOffsetX ?? 0,
    contentOffsetY: args.contentOffsetY ?? 0,
    fitBodyToFrame: args.fitBodyToFrame,
  });
  const bridges =
    INTERACT_PREVIEW_BRIDGES +
    (args.heightMode === "hug" ? contentSizeReportBridge(args.heightMode) : "");
  if (/<\/(?:body|html)\s*>/i.test(frameContent)) {
    return injectSessionReplayIframeBootstrap(
      injectDocumentMarkup(frameContent, bridges),
    );
  }
  const frameStyle = [
    getEmbeddedFrameBackgroundStyle({
      embeddedFrameBackground: args.embeddedFrameBackground,
      transparentBackground: args.transparentBackground,
    }),
    embeddedContentOffsetStyle(
      args.contentOffsetX ?? 0,
      args.contentOffsetY ?? 0,
    ),
  ].join("");
  return injectSessionReplayIframeBootstrap(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${frameStyle}</head><body>${localizedContent}${bridges}</body></html>`,
  );
}
