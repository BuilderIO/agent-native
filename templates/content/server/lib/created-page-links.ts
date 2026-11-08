import {
  getConfiguredAppBasePath,
  type AgentLoopFinalResponseGuard,
  type AgentLoopFinalResponseGuardContext,
} from "@agent-native/core/server";
import { getRequestContext } from "@agent-native/core/server/request-context";

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
    // A truncated or plain-text result names no Page we can link.
    return null;
  }
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

/** IDs a later `delete-document` call in the same turn moved to Trash. */
function trashedPageIds(context: AgentLoopFinalResponseGuardContext) {
  const succeeded = new Set(
    context.toolResults
      .filter((result) => !result.isError && result.toolCallId)
      .map((result) => result.toolCallId),
  );
  const ids = new Set<string>();
  for (const call of context.toolCalls) {
    if (call.name !== "delete-document" || !succeeded.has(call.toolCallId)) {
      continue;
    }
    const id = nonEmptyString(asRecord(call.input)?.id);
    if (id) ids.add(id);
  }
  return ids;
}

export function createdPages(
  context: AgentLoopFinalResponseGuardContext,
): CreatedPage[] {
  const trashed = trashedPageIds(context);
  const pages = new Map<string, CreatedPage>();
  for (const result of context.toolResults) {
    if (result.isError || !PAGE_CREATING_TOOLS.has(result.name)) continue;
    for (const page of pagesFromResult(result)) {
      if (!trashed.has(page.id) && !pages.has(page.id)) {
        pages.set(page.id, page);
      }
    }
  }
  return [...pages.values()];
}

// Markdown link targets and bare web URLs, the two forms chat renders as
// clickable links.
const LINK_TARGETS = /\]\(\s*<?([^)\s>]+)|https?:\/\/[^\s<>()[\]]+/g;

function linkTargets(text: string): string[] {
  return [...text.matchAll(LINK_TARGETS)].map((match) => match[1] ?? match[0]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function linksPage(targets: readonly string[], id: string): boolean {
  const idToken = new RegExp(
    `(?:^|[^A-Za-z0-9_-])${escapeRegExp(id)}(?:$|[^A-Za-z0-9_-])`,
  );
  return targets.some((target) => idToken.test(target));
}

/**
 * The Page's canonical route on this app's own origin. An absolute link opens
 * in the same tab in Content and still works where a delegated reply lands,
 * such as Slack.
 */
export function createdPageUrl(id: string): string {
  const origin = (getRequestContext()?.requestOrigin ?? "").replace(/\/+$/, "");
  return `${origin}${getConfiguredAppBasePath()}/page/${encodeURIComponent(id)}`;
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
export const requireCreatedPageLinks: AgentLoopFinalResponseGuard = (
  context,
) => {
  const targets = linkTargets(context.text);
  const missing = createdPages(context).filter(
    (page) => !linksPage(targets, page.id),
  );
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
