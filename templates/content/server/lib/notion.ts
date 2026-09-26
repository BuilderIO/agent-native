import crypto from "node:crypto";

import { parseIconValue, type IconValue } from "@agent-native/core/icons";
import { findConnectedMcpServersForProvider } from "@agent-native/core/mcp-client";
import {
  deleteOAuthTokens,
  listOAuthAccountsByOwner,
  saveOAuthTokens,
} from "@agent-native/core/oauth-tokens";
import {
  getRequestOrgId,
  getSession,
  resolveSecret,
  runWithRequestContext,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import {
  createError,
  getHeader,
  getRequestURL,
  setCookie,
  type H3Event,
} from "h3";

import { canonicalizeNfm } from "../../shared/nfm.js";

export const NOTION_PROVIDER = "notion";
export const NOTION_API_BASE = "https://api.notion.com/v1";
export const NOTION_API_VERSION = "2026-03-11";

export const NOTION_OAUTH_STATE_COOKIE = "notion_oauth_state";

type NotionTokens = {
  access_token?: string;
  workspace_id?: string;
  workspace_name?: string;
  workspace_icon?: string | null;
  bot_id?: string;
};

type NotionPage = {
  id: string;
  url?: string;
  icon?: {
    type: string;
    emoji?: string;
    external?: { url?: string };
    file?: { url?: string };
    custom_emoji?: { url?: string; name?: string };
  } | null;
  last_edited_time?: string;
  properties?: Record<string, any>;
  parent?: Record<string, any>;
};

export type NotionPageMarkdown = {
  object: "page_markdown";
  id: string;
  markdown: string;
  truncated: boolean;
  unknown_block_ids: string[];
};

export type NotionPageContent = {
  pageId: string;
  title: string;
  icon: IconValue | null;
  content: string;
  lastEditedTime: string | null;
  warnings: string[];
};

const UNKNOWN_BLOCK_TAG_RE = /(^[ \t]*)<unknown\b[^>]*\/>\s*$/m;
const UNKNOWN_BLOCK_COUNT_RE = /<unknown\b[^>]*\/>/g;

export class NotionApiError extends Error {
  status: number;
  code: string | null;
  body: any;

  constructor(message: string, status: number, code: string | null, body: any) {
    super(message);
    this.name = "NotionApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

function iconFromNotion(icon: NotionPage["icon"]): IconValue | null {
  if (icon?.type === "emoji" && icon.emoji) {
    return { version: 1, kind: "emoji", emoji: icon.emoji };
  }
  const url = icon?.external?.url;
  return url
    ? {
        version: 1,
        kind: "image",
        authority: "notion",
        assetId: url,
        alt: icon?.custom_emoji?.name,
      }
    : null;
}

function iconForNotion(icon: IconValue | string | null | undefined) {
  if (!icon) return undefined;
  const parsed = parseIconValue(icon);
  if (!parsed) return undefined;
  if (parsed.kind === "emoji") return { type: "emoji", emoji: parsed.emoji };
  if (parsed.kind === "image") {
    return { type: "external", external: { url: parsed.assetId } };
  }
  return undefined;
}

function getOrigin(event: H3Event): string {
  return getRequestURL(event, {
    xForwardedHost: true,
    xForwardedProto: true,
  }).origin;
}

/**
 * Mirrors the `isSecureRequest`/proto-sniffing convention used elsewhere in
 * this app (see `public-documents.ts`, and `plan`'s `public-plans.ts`):
 * prefer `x-forwarded-proto` (set by the hosting proxy in production), then
 * fall back to the `origin` header's scheme, defaulting to insecure. A
 * hardcoded `secure: true` here would make browsers silently drop the
 * cookie on any plain-http origin (Safari does this even for
 * `http://localhost`), making `buildNotionAuthUrl`'s CSRF-binding cookie
 * never arrive and Connect Notion permanently fail in http dev.
 */
function isSecureRequest(event: H3Event): boolean {
  const proto =
    getHeader(event, "x-forwarded-proto") ??
    (getHeader(event, "origin")?.startsWith("https://") ? "https" : "http");
  return proto === "https";
}

function getStateSecret(): string | null {
  return (
    process.env.NOTION_STATE_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    process.env.AUTH_SECRET ||
    null
  );
}

function signRedirectPath(redirectPath: string): string | null {
  const secret = getStateSecret();
  if (!secret) return null;
  return crypto
    .createHmac("sha256", secret)
    .update(`redirectPath:${redirectPath}`)
    .digest("base64url");
}

function encodeState(data: Record<string, string>, nonce: string): string {
  const payload = { ...data, n: nonce };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

async function resolveNotionOAuthCredentials(event: H3Event): Promise<{
  clientId: string;
  clientSecret: string;
} | null> {
  const session = await getSession(event).catch(() => null);
  return runWithRequestContext(
    { userEmail: session?.email, orgId: session?.orgId },
    async () => {
      const [clientId, clientSecret] = await Promise.all([
        resolveSecret("NOTION_CLIENT_ID"),
        resolveSecret("NOTION_CLIENT_SECRET"),
      ]);
      if (!clientId || !clientSecret) return null;
      return { clientId, clientSecret };
    },
  );
}

async function notionBasicAuthHeader(event: H3Event): Promise<string> {
  const credentials = await resolveNotionOAuthCredentials(event);
  const clientId = credentials?.clientId;
  const clientSecret = credentials?.clientSecret;
  if (!clientId || !clientSecret) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "Notion OAuth credentials are not configured. Save NOTION_CLIENT_ID and NOTION_CLIENT_SECRET in settings.",
    });
  }
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

function richTextToPlain(
  parts: Array<{ plain_text?: string }> | undefined,
): string {
  return (parts || []).map((part) => part.plain_text || "").join("");
}

function extractPageTitle(page: NotionPage): string {
  const properties = page.properties || {};
  const titleProperty = Object.values(properties).find(
    (value: any) => value?.type === "title",
  ) as any;
  return richTextToPlain(titleProperty?.title || []) || "Untitled";
}

function pageTitlePropertyName(page: NotionPage): string {
  const properties = page.properties || {};
  return (
    Object.entries(properties).find(
      ([, value]: any) => value?.type === "title",
    )?.[0] || "title"
  );
}

function countUnknownBlocks(markdown: string): number {
  return markdown.match(UNKNOWN_BLOCK_COUNT_RE)?.length || 0;
}

function replaceFirstUnknownPlaceholder(
  markdown: string,
  replacement: string,
): string {
  const lineMatch = markdown.match(UNKNOWN_BLOCK_TAG_RE);
  if (!lineMatch) {
    return markdown.replace(/<unknown\b[^>]*\/>/, replacement);
  }

  const [fullMatch, indent] = lineMatch;
  const indentedReplacement = replacement
    .split("\n")
    .map((line) => (line ? `${indent}${line}` : line))
    .join("\n");

  return markdown.replace(fullMatch, indentedReplacement);
}

function uniqueWarnings(warnings: string[]): string[] {
  return [...new Set(warnings.filter(Boolean))];
}

function formatPushError(error: unknown): Error {
  if (
    error instanceof NotionApiError &&
    error.code === "validation_error" &&
    /delete child pages or databases/i.test(error.message)
  ) {
    return new Error(
      "Push blocked because replacing this Notion page would delete child pages or databases. The sync keeps that content safe by default.",
    );
  }

  if (
    error instanceof NotionApiError &&
    error.code === "validation_error" &&
    /synced page/i.test(error.message)
  ) {
    return new Error(
      "Push blocked because synced Notion pages cannot be updated through the markdown API.",
    );
  }

  return error instanceof Error ? error : new Error("Notion update failed");
}

async function hydrateUnknownBlockSubtrees(
  accessToken: string,
  markdown: string,
  unknownBlockIds: string[],
  warnings: string[],
  seen = new Set<string>(),
): Promise<string> {
  let hydrated = markdown;

  for (const blockId of unknownBlockIds) {
    if (!blockId || seen.has(blockId)) continue;
    seen.add(blockId);

    try {
      const subtree = await fetchNotionMarkdown(accessToken, blockId);
      const resolvedSubtree = await hydrateUnknownBlockSubtrees(
        accessToken,
        subtree.markdown,
        subtree.unknown_block_ids,
        warnings,
        seen,
      );

      hydrated = replaceFirstUnknownPlaceholder(
        hydrated,
        canonicalizeNfm(resolvedSubtree),
      );
    } catch (error) {
      if (
        error instanceof NotionApiError &&
        error.code === "object_not_found"
      ) {
        warnings.push(
          "Some child Notion blocks could not be loaded because the integration does not have access to them.",
        );
        continue;
      }

      warnings.push(
        error instanceof Error
          ? `Failed to load a nested Notion subtree: ${error.message}`
          : "Failed to load a nested Notion subtree.",
      );
    }
  }

  return hydrated;
}

export async function resolveNotionMarkdownResponse(
  accessToken: string,
  response: NotionPageMarkdown,
): Promise<{ markdown: string; warnings: string[] }> {
  const warnings: string[] = [];

  let markdown = await hydrateUnknownBlockSubtrees(
    accessToken,
    response.markdown,
    response.unknown_block_ids,
    warnings,
  );

  if (response.truncated) {
    warnings.push(
      "This Notion page exceeded the markdown API block limit. The importer fetched additional subtrees where possible and preserved any remaining gaps as <unknown /> blocks.",
    );
  }

  const remainingUnknown = countUnknownBlocks(markdown);
  if (remainingUnknown > 0) {
    warnings.push(
      remainingUnknown === 1
        ? "One Notion block is still preserved as <unknown /> because it is unsupported or inaccessible."
        : `${remainingUnknown} Notion blocks are still preserved as <unknown /> because they are unsupported or inaccessible.`,
    );
  }

  markdown = canonicalizeNfm(markdown);

  return { markdown, warnings: uniqueWarnings(warnings) };
}

export function normalizeNotionPageId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Notion page ID or URL is required.");
  if (/^[0-9a-fA-F]{32}$/.test(trimmed)) return trimmed;
  if (/^[0-9a-fA-F-]{36}$/.test(trimmed)) return trimmed.replace(/-/g, "");
  try {
    const url = new URL(trimmed);
    const slug = url.pathname.split("/").filter(Boolean).pop() || "";
    const match =
      slug.match(/([0-9a-fA-F]{32})$/) || slug.match(/([0-9a-fA-F-]{36})$/);
    if (match?.[1]) return match[1].replace(/-/g, "");
  } catch {}
  throw new Error("Invalid Notion page ID or URL.");
}

const NOTION_FETCH_TIMEOUT_MS = 15_000;
const NOTION_RETRY_AFTER_CAP_SECONDS = 5;

export async function notionFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const MAX_RETRIES = 2;
  for (let attempt = 0; ; attempt++) {
    const headers = new Headers({
      Authorization: `Bearer ${accessToken}`,
      "Notion-Version": NOTION_API_VERSION,
      "Content-Type": "application/json",
    });
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    const response = await fetch(`${NOTION_API_BASE}${path}`, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(NOTION_FETCH_TIMEOUT_MS),
      headers,
    });
    if (response.status === 429 && attempt < MAX_RETRIES) {
      const rawRetryAfter = Number(response.headers.get("retry-after"));
      const retryAfterSeconds =
        Number.isFinite(rawRetryAfter) && rawRetryAfter > 0 ? rawRetryAfter : 1;
      if (retryAfterSeconds <= NOTION_RETRY_AFTER_CAP_SECONDS) {
        await new Promise((r) => setTimeout(r, retryAfterSeconds * 1000));
        continue;
      }
      // Retry-After exceeds what we're willing to block a request for —
      // surface the 429 immediately so the caller can record lastError
      // instead of stalling the handler.
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new NotionApiError(
        body?.message || `Notion request failed (${response.status})`,
        response.status,
        body?.code || null,
        body,
      );
    }
    return body as T;
  }
}

export async function fetchNotionPage(
  accessToken: string,
  pageId: string,
): Promise<NotionPage> {
  return notionFetch<NotionPage>(`/pages/${pageId}`, accessToken);
}

export async function fetchNotionMarkdown(
  accessToken: string,
  pageId: string,
  includeTranscript = false,
): Promise<NotionPageMarkdown> {
  const query = includeTranscript ? "?include_transcript=true" : "";
  return notionFetch<NotionPageMarkdown>(
    `/pages/${pageId}/markdown${query}`,
    accessToken,
  );
}

export async function readNotionPageAsDocument(
  accessToken: string,
  pageId: string,
): Promise<NotionPageContent> {
  const [page, markdownResponse] = await Promise.all([
    fetchNotionPage(accessToken, pageId),
    fetchNotionMarkdown(accessToken, pageId),
  ]);
  const { markdown, warnings } = await resolveNotionMarkdownResponse(
    accessToken,
    markdownResponse,
  );

  return {
    pageId: page.id,
    title: extractPageTitle(page),
    icon: iconFromNotion(page.icon),
    content: markdown,
    lastEditedTime: page.last_edited_time || null,
    warnings,
  };
}

export async function pushDocumentToNotionPage(args: {
  accessToken: string;
  pageId: string;
  title: string;
  content: string;
  icon?: IconValue | string | null;
}): Promise<NotionPageContent> {
  const notionIcon = iconForNotion(args.icon);
  const page = await fetchNotionPage(args.accessToken, args.pageId);

  const markdown = canonicalizeNfm(args.content);

  try {
    await notionFetch(`/pages/${args.pageId}/markdown`, args.accessToken, {
      method: "PATCH",
      body: JSON.stringify({
        type: "replace_content",
        replace_content: {
          new_str: markdown,
          allow_deleting_content: false,
        },
      }),
    });
  } catch (error) {
    throw formatPushError(error);
  }

  const titleKey = pageTitlePropertyName(page);
  const updateBody: Record<string, unknown> = {
    properties: {
      [titleKey]: {
        title: [
          {
            type: "text",
            text: { content: args.title || "Untitled" },
          },
        ],
      },
    },
  };

  if (args.icon === null || notionIcon) updateBody.icon = notionIcon ?? null;

  await notionFetch(`/pages/${args.pageId}`, args.accessToken, {
    method: "PATCH",
    body: JSON.stringify(updateBody),
  });

  return readNotionPageAsDocument(args.accessToken, args.pageId);
}

export async function createNotionPageWithMarkdown(args: {
  accessToken: string;
  parentPageId: string;
  title: string;
  content: string;
  icon?: IconValue | string | null;
}): Promise<{ id: string; url: string }> {
  const body: Record<string, unknown> = {
    parent: { page_id: args.parentPageId },
    properties: {
      title: {
        title: [
          {
            type: "text",
            text: { content: args.title || "Untitled" },
          },
        ],
      },
    },
    markdown: canonicalizeNfm(args.content),
  };

  const notionIcon = iconForNotion(args.icon);
  if (notionIcon) body.icon = notionIcon;

  return notionFetch<{ id: string; url: string }>("/pages", args.accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getDocumentOwnerEmail(
  event: H3Event,
  documentId?: string,
): Promise<string> {
  const session = await getSession(event).catch(() => null);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  if (!documentId) return session.email;

  return runWithRequestContext(
    { userEmail: session.email, orgId: session.orgId },
    async () => {
      const access = await assertAccess("document", documentId, "editor").catch(
        () => null,
      );
      const owner = access?.resource?.ownerEmail;
      if (typeof owner !== "string" || owner.length === 0) {
        throw createError({
          statusCode: 404,
          statusMessage: "Document not found",
        });
      }
      return owner;
    },
  );
}

export async function getNotionConnectionForOwner(owner: string) {
  const accounts = await listOAuthAccountsByOwner(NOTION_PROVIDER, owner);
  if (accounts.length === 0) return null;
  const account = accounts[0];
  const tokens = account.tokens as NotionTokens | null;
  if (!tokens?.access_token) return null;
  return {
    accountId: account.accountId,
    tokens,
    accessToken: tokens.access_token,
    workspaceName: tokens.workspace_name || null,
    workspaceId: tokens.workspace_id || null,
  };
}

export async function requireNotionConnectionForOwner(
  owner: string,
  intent: string,
) {
  const connection = await getNotionConnectionForOwner(owner);
  if (connection) return connection;

  const mcp = await findConnectedMcpServersForProvider({
    providerId: NOTION_PROVIDER,
    userEmail: owner,
    orgId: getRequestOrgId() ?? null,
    // coercion-ok: null is the typed "status unreadable" answer and produces a
    // different error below than an empty, successfully-read server list.
  }).catch(() => null);

  const base = `Connect your Notion account before ${intent}.`;
  if (mcp === null) {
    throw new Error(
      `${base} Notion MCP connection status could not be read, so this may be the separate MCP connection rather than the account grant.`,
    );
  }
  if (mcp.servers.length > 0) {
    throw new Error(
      `${base} The Notion MCP server shown under Settings > Integrations is connected, but that is a separate connection and does not grant Content the account access it needs to link and sync documents.`,
    );
  }
  throw new Error(base);
}

export async function disconnectNotionForOwner(owner: string) {
  const accounts = await listOAuthAccountsByOwner(NOTION_PROVIDER, owner);
  let deleted = 0;
  for (const account of accounts) {
    deleted += await deleteOAuthTokens(NOTION_PROVIDER, account.accountId);
  }
  return deleted;
}

export async function hasNotionOAuthCredentials(
  event: H3Event,
): Promise<boolean> {
  return !!(await resolveNotionOAuthCredentials(event));
}

export async function buildNotionAuthUrl(
  event: H3Event,
  redirectPath = "/",
): Promise<string> {
  const credentials = await resolveNotionOAuthCredentials(event);
  if (!credentials?.clientId) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "Notion OAuth credentials are not configured. Save NOTION_CLIENT_ID and NOTION_CLIENT_SECRET in settings.",
    });
  }
  const redirectUri = `${getOrigin(event)}/api/notion/callback`;
  const nonce = crypto.randomBytes(16).toString("hex");
  const sig = signRedirectPath(redirectPath);
  const state = encodeState(
    sig ? { redirectPath, sig } : { redirectPath },
    nonce,
  );

  setCookie(event, NOTION_OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(event),
    path: "/",
    maxAge: 600,
  });

  const params = new URLSearchParams({
    owner: "user",
    client_id: credentials.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });
  return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
}

export async function exchangeNotionCodeForTokens(
  event: H3Event,
  code: string,
): Promise<NotionTokens> {
  const redirectUri = `${getOrigin(event)}/api/notion/callback`;
  const response = await fetch(`${NOTION_API_BASE}/oauth/token`, {
    method: "POST",
    signal: AbortSignal.timeout(NOTION_FETCH_TIMEOUT_MS),
    headers: {
      Authorization: await notionBasicAuthHeader(event),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.message || body?.error || "Notion OAuth failed");
  }
  return body as NotionTokens;
}

export async function saveNotionTokensForOwner(
  owner: string,
  tokens: NotionTokens,
) {
  const accountId = tokens.workspace_id || tokens.bot_id;
  if (!accountId) {
    throw new Error("Notion OAuth response missing workspace ID.");
  }
  await saveOAuthTokens(
    NOTION_PROVIDER,
    accountId,
    tokens as Record<string, unknown>,
    owner,
  );

  const accounts = await listOAuthAccountsByOwner(NOTION_PROVIDER, owner);
  await Promise.all(
    accounts
      .filter((account) => account.accountId !== accountId)
      .map((account) => deleteOAuthTokens(NOTION_PROVIDER, account.accountId)),
  );

  return accountId;
}


export interface NotionComment {
  id: string;
  rich_text: Array<{ plain_text: string }>;
  created_time: string;
  created_by: { id: string };
  discussion_id?: string;
}

const MAX_COMMENT_PAGES = 20;

export async function listNotionComments(
  pageId: string,
  accessToken: string,
): Promise<NotionComment[]> {
  const results: NotionComment[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
    try {
      const query = new URLSearchParams({ block_id: pageId, page_size: "100" });
      if (cursor) query.set("start_cursor", cursor);
      const data = await notionFetch<{
        results?: NotionComment[];
        has_more?: boolean;
        next_cursor?: string | null;
      }>(`/comments?${query.toString()}`, accessToken);
      results.push(...(data.results ?? []));
      if (!data.has_more || !data.next_cursor) break;
      cursor = data.next_cursor;
    } catch (error) {
      if (
        error instanceof NotionApiError &&
        [401, 403, 404, 429].includes(error.status)
      ) {
        throw error;
      }
      if (results.length > 0) break;
      throw error;
    }
  }
  return results;
}

export type AddedNotionComment = {
  id: string;
  discussionId: string | null;
};

/**
 * Add a comment to a Notion page, or a reply to an existing discussion
 * thread when `discussionId` is provided. Passing `discussion_id` (instead
 * of a `parent` page reference) is what makes Notion append the comment to
 * that thread as a reply rather than starting a new, unrelated top-level
 * comment — see sync-notion-comments.ts for how local comment replies map
 * to a stored `notion_discussion_id`.
 *
 * Auth/permission/rate-limit failures (401/403/404/429) are rethrown so
 * sync-notion-comments can surface a real error instead of silently
 * reporting the comment as pushed.
 */
export async function addNotionComment(
  pageId: string,
  text: string,
  accessToken: string,
  discussionId?: string | null,
): Promise<AddedNotionComment | null> {
  try {
    const body = discussionId
      ? {
          discussion_id: discussionId,
          rich_text: [{ text: { content: text } }],
        }
      : {
          parent: { page_id: pageId },
          rich_text: [{ text: { content: text } }],
        };
    const data = await notionFetch<{ id?: string; discussion_id?: string }>(
      "/comments",
      accessToken,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
    if (!data.id) return null;
    return {
      id: data.id,
      discussionId: data.discussion_id ?? discussionId ?? null,
    };
  } catch (error) {
    if (
      error instanceof NotionApiError &&
      [401, 403, 404, 429].includes(error.status)
    ) {
      throw error;
    }
    return null;
  }
}
