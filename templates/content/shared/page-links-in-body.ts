import { isContentLinkId, pageLinkBlockId } from "./content-links.js";
import { nfmToDoc, type PMNode } from "./nfm.js";

export const PAGE_LINKS_MAX_PER_PAGE = 1_000;

export const PAGE_LINK_MARKERS = [
  "/page/",
  "/p/",
  "documentId=",
  "<page",
  "<mention-page",
] as const;

const RELATIVE_BASE = "https://relative.invalid";

export function mayHoldPageLinks(body: string | null | undefined): boolean {
  return !!body && PAGE_LINK_MARKERS.some((marker) => body.includes(marker));
}

function decodedSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    // coercion-ok: a path segment that doesn't decode names no page.
    return null;
  }
}

export function pageIdFromHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  const target = href.trim();
  const absolute = /^https?:\/\//i.test(target);
  if (!absolute && !target.startsWith("/")) return null;
  if (!URL.canParse(target, RELATIVE_BASE)) return null;
  const url = new URL(target, RELATIVE_BASE);
  if (!absolute && url.origin !== RELATIVE_BASE) return null;
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/_agent-native/open")) {
    const app = url.searchParams.get("app");
    if (app && app !== "content") return null;
    return url.searchParams.get("documentId") || null;
  }
  const match = path.match(/\/(?:page|p)\/([^/]+)$/);
  return match?.[1] ? decodedSegment(match[1]) : null;
}

function atomAttrs(value: unknown): Record<string, string> {
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    // coercion-ok: an atom whose attributes don't parse names no page.
    return {};
  }
}

function isPageLinkAtom(node: PMNode): boolean {
  const tagName = node.attrs?.tagName;
  return (
    (node.type === "notionBlockAtom" && tagName === "page") ||
    (node.type === "notionInlineAtom" && tagName === "mention-page")
  );
}

export function pageLinkTargetsInBody(
  body: string | null | undefined,
): string[] {
  if (!body || !mayHoldPageLinks(body)) return [];
  const ids = new Set<string>();
  const add = (id: string | null | undefined) => {
    if (id && isContentLinkId(id) && ids.size < PAGE_LINKS_MAX_PER_PAGE) {
      ids.add(id);
    }
  };
  const visit = (node: PMNode) => {
    for (const mark of node.marks ?? []) {
      if (mark.type === "link") add(pageIdFromHref(mark.attrs?.href));
    }
    if (isPageLinkAtom(node)) {
      const attrs = atomAttrs(node.attrs?.attrsJson);
      add(pageLinkBlockId(attrs));
      add(pageIdFromHref(attrs.url));
      add(pageIdFromHref(attrs.href));
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const node of nfmToDoc(body).content) visit(node);
  return [...ids];
}
