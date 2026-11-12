import {
  declaredLinkOrigin,
  getConfiguredAppBasePath,
  toAbsoluteOpenUrl,
  type AgentLoopFinalResponseGuard,
  type AgentLoopFinalResponseGuardContext,
} from "@agent-native/core/server";
import {
  getRequestContext,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import { and, inArray } from "drizzle-orm";
import type { Nodes } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { getDb, schema } from "../db/index.js";

/** Actions whose success leaves the user a new standalone Page. */
const PAGE_CREATING_TOOLS = new Set([
  "create-document",
  "duplicate-page",
  "clone-creative-context-document",
]);

const MAX_TITLE_CHARS = 120;

interface CreatedPage {
  id: string;
  title: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseRecord(content: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(content));
  } catch {
    // coercion-ok: a truncated or plain-text result names no Page, like JSON without one.
    return null;
  }
}

/**
 * The origin this app's links use, by core's rule for links the server hands
 * out: the request's own origin only when the app declares it, else the one
 * the app declares, so a forwarded host can't send a link elsewhere. Without
 * one, links stay relative.
 */
function linkOrigin(): string | undefined {
  return declaredLinkOrigin(getRequestContext()?.requestOrigin);
}

function pagesFromResult(
  result: AgentLoopFinalResponseGuardContext["toolResults"][number],
): CreatedPage[] {
  // Receipts are read before the result is truncated, so a long Page body
  // still yields its ID.
  const receipts = (result.artifacts ?? []).filter(
    (artifact) => artifact.kind === "document",
  );
  if (receipts.length > 0) {
    return receipts.map((artifact) => ({
      id: artifact.id,
      title: artifact.title ?? "",
    }));
  }
  const record = parseRecord(result.content);
  const id = nonEmptyString(record?.id);
  return id ? [{ id, title: nonEmptyString(record?.title) ?? "" }] : [];
}

export function createdPages(
  context: AgentLoopFinalResponseGuardContext,
): CreatedPage[] {
  const pages = new Map<string, CreatedPage>();
  for (const result of context.toolResults) {
    if (result.isError || !PAGE_CREATING_TOOLS.has(result.name)) continue;
    for (const page of pagesFromResult(result)) {
      if (!pages.has(page.id)) pages.set(page.id, page);
    }
  }
  return [...pages.values()];
}

// Chat renders replies as GitHub-flavored Markdown, so a reply is parsed the
// same way: a link counts only where the reader sees one. Code, images, and
// escaped or unclosed brackets stay text, and a bare URL leaves out the
// punctuation that ends its sentence.
const markdown = unified().use(remarkParse).use(remarkGfm);

/** Where the reply's links go: inline, reference, autolink and bare URL. */
function linkTargets(text: string): string[] {
  const targets: string[] = [];
  const references: string[] = [];
  const definitions = new Map<string, string>();
  const visit = (node: Nodes) => {
    if (node.type === "link") targets.push(node.url);
    if (node.type === "linkReference") references.push(node.identifier);
    if (node.type === "definition") {
      definitions.set(node.identifier, node.url);
    }
    if ("children" in node) node.children.forEach(visit);
  };
  visit(markdown.parse(text));
  for (const identifier of references) {
    const url = definitions.get(identifier);
    if (url) targets.push(url);
  }
  return targets;
}

// A root-relative link resolves against this only so its path can be read.
const RELATIVE_BASE = "https://relative.invalid";

/**
 * Whether a link opens the Page: its route or its open link under this app's
 * base path, as a path or on this app's origin. A relative target must still
 * resolve to the origin it was read against: "//host" and "/\host" both name
 * another host.
 */
function opensPage(
  target: string,
  origin: string | undefined,
  id: string,
): boolean {
  const base = origin ?? RELATIVE_BASE;
  if (!URL.canParse(target, base)) return false;
  const url = new URL(target, base);
  const expected = URL.canParse(target) ? origin : new URL(base).origin;
  if (url.origin !== expected) return false;
  const basePath = getConfiguredAppBasePath();
  const path = url.pathname.replace(/\/+$/, "");
  return (
    path === `${basePath}/page/${encodeURIComponent(id)}` ||
    (path === `${basePath}/_agent-native/open` &&
      url.searchParams.get("documentId") === id)
  );
}

/**
 * The Page's canonical route, absolute on this app's origin. An absolute link
 * opens in the same tab in Content and still works where a delegated reply
 * lands, such as Slack.
 */
export function createdPageUrl(id: string): string {
  return toAbsoluteOpenUrl(`/page/${encodeURIComponent(id)}`, linkOrigin());
}

/**
 * Which of `ids` are live Pages the user can open, saved and out of Trash, as
 * the database has them now: the turn may since have deleted a Page it
 * created, or that Page's parent. Undefined when the database can't say,
 * including when no user is known to check access for.
 */
async function livePageIds(ids: string[]): Promise<Set<string> | undefined> {
  if (!getRequestUserEmail()) return undefined;
  try {
    const rows = await getDb()
      .select({
        id: schema.documents.id,
        trashedAt: schema.documents.trashedAt,
      })
      .from(schema.documents)
      .where(
        and(
          inArray(schema.documents.id, ids),
          accessFilter(schema.documents, schema.documentShares),
        ),
      );
    return new Set(rows.flatMap((row) => (row.trashedAt ? [] : [row.id])));
  } catch (error) {
    console.warn("[created-page-links] could not check the new Pages", error);
    return undefined;
  }
}

function linkText(title: string): string {
  const oneLine = title
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const clipped =
    oneLine.length > MAX_TITLE_CHARS
      ? `${oneLine.slice(0, MAX_TITLE_CHARS - 1)}…`
      : oneLine;
  return (clipped || "Untitled")
    .replace(/[[\]\\]/g, "\\$&")
    .replace(/</g, "‹")
    .replace(/>/g, "›");
}

function pageLink(page: CreatedPage): string {
  return `[${linkText(page.title)}](${createdPageUrl(page.id)})`;
}

/**
 * Sends the answer back once when it doesn't link every Page the turn
 * created, then puts the links above the draft. The user should never have to
 * ask where a new Page is.
 */
export const requireCreatedPageLinks: AgentLoopFinalResponseGuard = async (
  context,
) => {
  const pages = createdPages(context);
  if (pages.length === 0) return null;
  const targets = linkTargets(context.text);
  const origin = linkOrigin();
  const unlinked = pages.filter(
    (page) => !targets.some((target) => opensPage(target, origin, page.id)),
  );
  if (unlinked.length === 0) return null;
  const live = await livePageIds(unlinked.map((page) => page.id));
  const missing = live
    ? unlinked.filter((page) => live.has(page.id))
    : unlinked;
  if (missing.length === 0) return null;
  const one = missing.length === 1;
  const links = missing.map((page) => `- ${pageLink(page)}`).join("\n");
  const which = one ? "the page" : "every page";
  if (!live) {
    // Only the agent knows now whether it moved one to Trash, so it's asked to
    // leave those out. Links it still omits go above its answer, marked as
    // unconfirmed.
    const unconfirmed = `${one ? "New page" : "New pages"} (Content couldn't confirm ${one ? "it's" : "they're"} still out of Trash):\n${links}`;
    return {
      retryMessage: `Your answer does not link ${which} you created this turn. Content couldn't check whether you since moved any to Trash, so link each one you didn't, using these exact links:\n${links}`,
      fallbackMessage: unconfirmed,
      exhaustedDraftPrefix: unconfirmed,
      maxRetries: 1,
    };
  }
  const summary = `${one ? "New page" : "New pages"}:\n${links}`;
  return {
    retryMessage: `Your answer does not link ${which} you created this turn. Revise it so it links each one, using these exact links:\n${links}`,
    fallbackMessage: summary,
    exhaustedDraftPrefix: summary,
    maxRetries: 1,
  };
};
