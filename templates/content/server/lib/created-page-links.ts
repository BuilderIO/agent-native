import {
  getAppConfig,
  getConfiguredAppBasePath,
  type AgentLoopFinalResponseGuard,
  type AgentLoopFinalResponseGuardContext,
} from "@agent-native/core/server";
import { getRequestContext } from "@agent-native/core/server/request-context";
import { and, inArray, isNotNull } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";

/** Actions whose success leaves the user a new standalone Page. */
const PAGE_CREATING_TOOLS = new Set(["create-document", "duplicate-page"]);

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

function originOf(value: unknown): string | undefined {
  const text = nonEmptyString(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    // "localhost:8080" parses, with the scheme "localhost:" and no origin.
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : undefined;
  } catch {
    // coercion-ok: a value that isn't a URL names no origin.
    return undefined;
  }
}

/**
 * Where this app's Pages open: the host the request came in on, then the
 * configured app URL, which is all a scheduled or delegated run has.
 */
function appOrigins(): string[] {
  const origins = [
    originOf(getRequestContext()?.requestOrigin),
    originOf(getAppConfig().app.url),
  ];
  return [...new Set(origins.filter((origin): origin is string => !!origin))];
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

// Markdown link targets and bare web URLs, the two forms chat renders as
// clickable links. Code spans and fenced blocks render as text, so they're
// taken out first.
const CODE = /(```|~~~)[\s\S]*?(?:\1|$)|`[^`\n]*`/g;
const MARKDOWN_LINK_TARGETS = /\]\(\s*<?([^)\s>]+)/g;
const BARE_URLS = /https?:\/\/[^\s<>()[\]]+/g;
const HAS_SCHEME = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

function linkTargets(text: string): string[] {
  const prose = text.replace(CODE, " ");
  return [
    ...[...prose.matchAll(MARKDOWN_LINK_TARGETS)].flatMap((match) =>
      match[1] ? [match[1]] : [],
    ),
    ...[...prose.matchAll(BARE_URLS)].map((match) => match[0]),
  ];
}

/** A relative link opens this app; an absolute one must use its origin. */
function opensThisApp(target: string, origins: readonly string[]): boolean {
  if (!HAS_SCHEME.test(target)) return true;
  const origin = originOf(target.startsWith("//") ? `https:${target}` : target);
  return origin !== undefined && origins.includes(origin);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function linksPage(
  targets: readonly string[],
  origins: readonly string[],
  id: string,
): boolean {
  const idToken = new RegExp(
    `(?:^|[^A-Za-z0-9_-])${escapeRegExp(id)}(?:$|[^A-Za-z0-9_-])`,
  );
  return targets.some(
    (target) => opensThisApp(target, origins) && idToken.test(target),
  );
}

/**
 * The Page's canonical route on this app's own origin. An absolute link opens
 * in the same tab in Content and still works where a delegated reply lands,
 * such as Slack. With no origin known, the app-relative route is all there is.
 */
export function createdPageUrl(id: string): string {
  const [origin = ""] = appOrigins();
  return `${origin}${getConfiguredAppBasePath()}/page/${encodeURIComponent(id)}`;
}

/**
 * Pages among `ids` now in Trash, as when the turn deleted a Page it created
 * or that Page's parent. The database is the record: a delete's result lists
 * at most 100 of the Pages it moved.
 */
async function trashedPageIds(ids: string[]): Promise<Set<string>> {
  try {
    const rows = await getDb()
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          inArray(schema.documents.id, ids),
          isNotNull(schema.documents.trashedAt),
        ),
      );
    return new Set(rows.map((row) => row.id));
  } catch (error) {
    // coercion-ok: a thrown guard fails the whole turn; a link to a trashed Page costs less.
    console.warn("[created-page-links] could not check Trash", error);
    return new Set();
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
  const targets = linkTargets(context.text);
  const origins = appOrigins();
  const unlinked = createdPages(context).filter(
    (page) => !linksPage(targets, origins, page.id),
  );
  if (unlinked.length === 0) return null;
  const trashed = await trashedPageIds(unlinked.map((page) => page.id));
  const missing = unlinked.filter((page) => !trashed.has(page.id));
  if (missing.length === 0) return null;
  const links = missing.map((page) => `- ${pageLink(page)}`).join("\n");
  const summary = `${missing.length === 1 ? "New page" : "New pages"}:\n${links}`;
  return {
    retryMessage: `Your answer does not link ${
      missing.length === 1 ? "the page" : "every page"
    } you created this turn. Revise it so it links each one, using these exact links:\n${links}`,
    fallbackMessage: summary,
    exhaustedDraftPrefix: summary,
    maxRetries: 1,
  };
};
