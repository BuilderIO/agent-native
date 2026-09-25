import type { FigmaPasteLayer } from "@shared/figma-paste-plan";

/** Client helpers for a Figma paste: target screen and layer HTML. */

/** The screen whose selection receives the paste, or null for none. */
export function resolveFigmaPasteTargetScreenId(args: {
  viewMode: "single" | "overview";
  activeFileId: string | undefined;
  boardFileId: string | undefined;
  overviewSelectedScreenIds: readonly string[];
  hasLayerSelection: boolean;
}): string | null {
  const isScreen = (id: string | undefined): id is string =>
    Boolean(id) && id !== args.boardFileId;
  if (args.viewMode === "single") {
    return isScreen(args.activeFileId) ? args.activeFileId : null;
  }
  if (args.overviewSelectedScreenIds.length === 1) {
    const [screenId] = args.overviewSelectedScreenIds;
    return isScreen(screenId) ? screenId : null;
  }
  if (args.overviewSelectedScreenIds.length > 1) return null;
  return args.hasLayerSelection && isScreen(args.activeFileId)
    ? args.activeFileId
    : null;
}

/** The layer to insert, plus the stylesheet links its fonts need. */
export function figmaPasteLayerHtml(
  layer: Pick<FigmaPasteLayer, "content" | "wrapsLooseNode">,
): { html: string; headLinks: string[] } | null {
  const doc = new DOMParser().parseFromString(layer.content, "text/html");
  const root = doc.body.firstElementChild;
  const element = layer.wrapsLooseNode ? root?.firstElementChild : root;
  if (!element) return null;
  const headLinks = Array.from(
    doc.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  ).map((link) => link.outerHTML);
  return { html: element.outerHTML, headLinks };
}

export function withHeadLinks(content: string, links: string[]): string {
  if (links.length === 0) return content;
  const doc = new DOMParser().parseFromString(content, "text/html");
  const present = new Set(
    Array.from(doc.head.querySelectorAll("link[href]")).map((link) =>
      link.getAttribute("href"),
    ),
  );
  let added = false;
  for (const linkHtml of links) {
    const template = doc.createElement("template");
    template.innerHTML = linkHtml;
    const link = template.content.firstElementChild;
    if (!link || present.has(link.getAttribute("href"))) continue;
    doc.head.appendChild(link);
    present.add(link.getAttribute("href"));
    added = true;
  }
  return added ? `<!DOCTYPE html>\n${doc.documentElement.outerHTML}` : content;
}
