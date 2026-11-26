import { injectSessionReplayIframeBootstrap } from "@agent-native/core/client/host";
import { injectDocumentMarkup } from "@agent-native/core/shared";

import { interactLinksBridgeScript } from "../../../../.generated/bridge/interact-links.generated";
import { interactTweaksBridgeScript } from "../../../../.generated/bridge/interact-tweaks.generated";
import { renderResolvedRootBlock } from "../../../../shared/resolve-tweaks";
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
const INTERACT_TWEAKS_BRIDGE_SCRIPT = `<script data-agent-native-interact-tweaks-bridge>${interactTweaksBridgeScript}</script>`;

/**
 * What an Interact markup preview adds to the design: the theme bridge, which
 * the Light / Dark picker drives, the links bridge, which makes a link to
 * another screen switch screens, and the tweaks bridge, which applies knob
 * changes. Nothing here listens for scrolling, dragging, keys or pointer
 * input, so the page runs as it would in a tab. Explicit Hug previews also
 * report dimensions so their host can fit the authored content.
 */
const INTERACT_PREVIEW_BRIDGES =
  PREVIEW_THEME_BRIDGE_SCRIPT +
  INTERACT_LINKS_BRIDGE_SCRIPT +
  INTERACT_TWEAKS_BRIDGE_SCRIPT;

export const INTERACT_TWEAKS_STYLE_ATTRIBUTE =
  "data-agent-native-interact-tweaks";

/** The tweak values as `:root` CSS that cannot close its `<style>` element. */
export function renderInteractTweakBlock(
  tweakValues: Record<string, string> | undefined,
): string {
  return renderResolvedRootBlock(tweakValues ?? {}).replace(/</g, "\\3c ");
}

/**
 * The tweak values current when the document is built, so the first paint
 * already shows them. Later changes reach the tweaks bridge as a message,
 * which rewrites this element in place.
 */
function tweakValuesStyle(tweakValues: Record<string, string> | undefined) {
  const block = renderInteractTweakBlock(tweakValues);
  if (!block) return "";
  // Placed after the design's own :root rules, so it wins at equal specificity.
  return `<style ${INTERACT_TWEAKS_STYLE_ATTRIBUTE}>${block}</style>`;
}

/**
 * The document an Interact preview loads. It is the design as the editor
 * frames it (local Alpine and Tailwind, the runtimes the design embeds, the
 * frame's fit, background and offset, the current tweak values) with only the
 * bridges above on top. Edit builds its document separately and keeps
 * every editor bridge.
 */
export function buildInteractPreviewDocument(args: {
  content: string;
  embeddedFrameBackground?: string;
  transparentBackground?: boolean;
  contentOffsetX?: number;
  contentOffsetY?: number;
  fitBodyToFrame: boolean;
  heightMode?: ScreenHeightMode;
  tweakValues?: Record<string, string>;
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
    tweakValuesStyle(args.tweakValues) +
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
