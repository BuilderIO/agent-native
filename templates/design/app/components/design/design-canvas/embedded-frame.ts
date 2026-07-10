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
  if (/<\/head>/i.test(content)) {
    return content.replace(/<\/head>/i, `${style}</head>`);
  }
  if (/<body\b/i.test(content)) {
    return content.replace(/<body\b/i, `${style}<body`);
  }
  return `${style}${content}`;
}

export function getEmbeddedFrameDocumentContent(args: {
  content: string;
  embeddedFrameBackground?: string;
  transparentBackground?: boolean;
  contentOffsetX?: number;
  contentOffsetY?: number;
}): string {
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
  return injectEmbeddedFrameStyle(args.content, frameStyle);
}
