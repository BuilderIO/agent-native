import {
  isContentLinkId,
  normalizeNotionPageId,
  pageLinkBlockId,
} from "./content-links.js";
import { nfmToDoc, type PMNode } from "./nfm.js";

export const PAGE_LINKS_MAX_PER_PAGE = 1_000;

export const PAGE_LINK_MARKERS = [
  "/page/",
  "/p/",
  "documentId=",
  "<page",
  "<mention-page",
  "notion.so/",
  "notion.site/",
] as const;

const RELATIVE_BASE = "https://relative.invalid";

export type PageLinkReference = {
  id: string;
  outside: boolean;
};

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

function isAbsoluteHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

export function pageIdFromHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  const target = href.trim();
  const absolute = isAbsoluteHref(target);
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

function notionPageKeyFromHref(href: string): string | null {
  if (!isAbsoluteHref(href) || !URL.canParse(href)) return null;
  const host = new URL(href).hostname.toLowerCase();
  const notion = ["notion.so", "notion.site"].some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
  return notion ? normalizeNotionPageId(href) : null;
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

export function pageLinkReferencesInBody(
  body: string | null | undefined,
): PageLinkReference[] {
  if (!body || !mayHoldPageLinks(body)) return [];
  const references = new Map<string, PageLinkReference>();
  const add = (value: string | null | undefined, outside: boolean) => {
    if (!value || !isContentLinkId(value)) return;
    const id = normalizeNotionPageId(value) ?? value;
    const seen = references.get(id);
    if (seen) {
      seen.outside &&= outside;
    } else if (references.size < PAGE_LINKS_MAX_PER_PAGE) {
      references.set(id, { id, outside });
    }
  };
  const addHref = (href: unknown, inPageAtom = false) => {
    if (typeof href !== "string") return;
    const target = href.trim();
    const notionKey = notionPageKeyFromHref(target);
    if (notionKey) add(notionKey, false);
    else add(pageIdFromHref(target), !inPageAtom && isAbsoluteHref(target));
  };
  const visit = (node: PMNode) => {
    for (const mark of node.marks ?? []) {
      if (mark.type === "link") addHref(mark.attrs?.href);
    }
    if (isPageLinkAtom(node)) {
      const attrs = atomAttrs(node.attrs?.attrsJson);
      add(pageLinkBlockId(attrs), false);
      addHref(attrs.url, true);
      addHref(attrs.href, true);
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const node of nfmToDoc(body).content) visit(node);
  return [...references.values()];
}

export function pageLinkTargetsInBody(
  body: string | null | undefined,
): string[] {
  return pageLinkReferencesInBody(body).map((reference) => reference.id);
}
