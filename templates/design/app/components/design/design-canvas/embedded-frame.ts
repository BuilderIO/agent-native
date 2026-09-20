import { injectDocumentMarkup } from "@agent-native/core/shared";

const TRANSPARENT_EMBEDDED_FRAME_STYLE =
  "<style data-agent-native-transparent-frame>html,body{background:transparent!important;}body{background-color:transparent!important;}</style>";

function embeddedFrameBackgroundStyle(background: string | undefined): string {
  const trimmed = background?.trim();
  if (!trimmed || /[;{}<>]/.test(trimmed)) return "";
  return `<style data-agent-native-frame-background>html,body{background:${trimmed}!important;}body{background-color:${trimmed}!important;}</style>`;
}

export function getEmbeddedFrameBackgroundStyle(args: {
  embeddedFrameBackground?: string;
  transparentBackground?: boolean;
}): string {
  return args.transparentBackground
    ? TRANSPARENT_EMBEDDED_FRAME_STYLE
    : embeddedFrameBackgroundStyle(args.embeddedFrameBackground);
}

export function getEmbeddedIframeBackgroundColor(args: {
  embeddedFrameBackground?: string;
  transparentBackground?: boolean;
}): string {
  return args.transparentBackground
    ? "transparent"
    : (args.embeddedFrameBackground ?? "transparent");
}

export function embeddedContentOffsetCss(x: number, y: number): string {
  if (x === 0 && y === 0) return "";
  return `body > [data-agent-native-node-id]{translate:${Math.round(x)}px ${Math.round(y)}px;}`;
}

export function embeddedContentOffsetStyle(x: number, y: number): string {
  const css = embeddedContentOffsetCss(x, y);
  return css ? `<style data-agent-native-content-offset>${css}</style>` : "";
}

function injectEmbeddedFrameStyle(content: string, style: string): string {
  if (!style) return content;
  if (/<\/head\s*>/i.test(content)) {
    return injectDocumentMarkup(content, style, { target: "head" });
  }
  if (/<body\b/i.test(content)) {
    return content.replace(/<body\b/i, `${style}<body`);
  }
  return `${style}${content}`;
}

/**
 * A screen's frame is sized by the board, but its document is sized by its own
 * CSS — so a body with no height rule ends where its content ends, leaving the
 * screen's fill and any border drawn short of the frame's edge. This makes the
 * document track the frame instead: `100%` resolves against the iframe, which
 * IS the frame, so it follows a resize with no writes to the file. `min-height`
 * (not `height`) keeps content taller than the frame growing as it does today,
 * and no `!important` so a document that sets its own height still wins.
 */
const EMBEDDED_FRAME_FIT_STYLE =
  "<style data-agent-native-frame-fit>html{height:100%}body{min-height:100%}</style>";

export function getEmbeddedFrameDocumentContent(args: {
  content: string;
  embeddedFrameBackground?: string;
  transparentBackground?: boolean;
  contentOffsetX?: number;
  contentOffsetY?: number;
  /** Board surfaces position their own content and opt out. */
  fitBodyToFrame?: boolean;
}): string {
  const frameStyle = [
    args.fitBodyToFrame ? EMBEDDED_FRAME_FIT_STYLE : "",
    getEmbeddedFrameBackgroundStyle({
      embeddedFrameBackground: args.embeddedFrameBackground,
      transparentBackground: args.transparentBackground,
    }),
    embeddedContentOffsetStyle(
      args.contentOffsetX ?? 0,
      args.contentOffsetY ?? 0,
    ),
  ].join("");
  return injectEmbeddedFrameStyle(args.content, frameStyle);
}
