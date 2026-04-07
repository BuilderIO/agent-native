import crypto from "node:crypto";
import {
  deleteOAuthTokens,
  getOAuthTokens,
  listOAuthAccountsByOwner,
  saveOAuthTokens,
} from "@agent-native/core/oauth-tokens";
import { getSession } from "@agent-native/core/server";
import type { H3Event } from "h3";
import { normalizeNfmForStorage } from "../../shared/notion-markdown.js";

export const NOTION_PROVIDER = "notion";
export const NOTION_API_BASE = "https://api.notion.com/v1";
export const NOTION_API_VERSION = "2026-03-11";

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
  icon?: { type: string; emoji?: string } | null;
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
  icon: string | null;
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

function getOrigin(event: H3Event): string {
  const host =
    event.node.req.headers["x-forwarded-host"] || event.node.req.headers.host;
  const proto = event.node.req.headers["x-forwarded-proto"] || "http";
  return `${proto}://${host}`;
}

function encodeState(data: Record<string, string>): string {
  const payload = { ...data, n: crypto.randomBytes(8).toString("hex") };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeState(stateParam: string | undefined): Record<string, string> {
  if (!stateParam) return {};
  try {
    return JSON.parse(Buffer.from(stateParam, "base64url").toString());
  } catch {
    return {};
  }
}

function notionBasicAuthHeader(): string {
  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Notion OAuth credentials are not configured. Set NOTION_CLIENT_ID and NOTION_CLIENT_SECRET.",
    );
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
        normalizeNfmForStorage(resolvedSubtree),
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

  markdown = normalizeNfmForStorage(markdown);

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

export async function notionFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const MAX_RETRIES = 2;
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${NOTION_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Notion-Version": NOTION_API_VERSION,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
    if (response.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(response.headers.get("retry-after")) || 1;
      await new Promise((r) => setTimeout(r, Math.max(retryAfter, 1) * 1000));
      continue;
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
    icon: page.icon?.type === "emoji" ? page.icon.emoji || null : null,
    content: markdown,
    lastEditedTime: page.last_edited_time || null,
    warnings,
  };
}

async function fetchChildPageIds(
  accessToken: string,
  pageId: string,
): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;

  do {
    const query = cursor
      ? `?start_cursor=${cursor}&page_size=100`
      : "?page_size=100";
    const response = await notionFetch<{
      results: Array<{ type: string; id: string }>;
      has_more: boolean;
      next_cursor: string | null;
    }>(`/blocks/${pageId}/children${query}`, accessToken);

    for (const block of response.results) {
      if (block.type === "child_page" || block.type === "child_database") {
        ids.push(block.id);
      }
    }

    cursor =
      response.has_more && response.next_cursor
        ? response.next_cursor
        : undefined;
  } while (cursor);

  return ids;
}

function appendChildPageTags(markdown: string, childPageIds: string[]): string {
  if (childPageIds.length === 0) return markdown;
  const tags = childPageIds.map((id) => `<page id="${id}" />`).join("\n");
  return `${markdown}\n${tags}`;
}

export async function pushDocumentToNotionPage(args: {
  accessToken: string;
  pageId: string;
  title: string;
  content: string;
  icon?: string | null;
}): Promise<NotionPageContent> {
  const [page, childPageIds] = await Promise.all([
    fetchNotionPage(args.accessToken, args.pageId),
    fetchChildPageIds(args.accessToken, args.pageId),
  ]);

  const markdown = appendChildPageTags(
    normalizeNfmForStorage(args.content),
    childPageIds,
  );

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

  if (args.icon) {
    updateBody.icon = { type: "emoji", emoji: args.icon };
  }

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
  icon?: string | null;
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
    markdown: normalizeNfmForStorage(args.content),
  };

  if (args.icon) {
    body.icon = { type: "emoji", emoji: args.icon };
  }

  return notionFetch<{ id: string; url: string }>("/pages", args.accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getDocumentOwnerEmail(event: H3Event): Promise<string> {
  const session = await getSession(event);
  return session?.email ?? "local@localhost";
}

export function getNotionApiKey(): string | null {
  return process.env.NOTION_API_KEY || null;
}

export async function getNotionConnectionForOwner(owner: string) {
  const apiKey = getNotionApiKey();
  if (apiKey) {
    return {
      accountId: "__api_key__",
      tokens: { access_token: apiKey } as NotionTokens,
      accessToken: apiKey,
      workspaceName: "API Key",
      workspaceId: null,
    };
  }

  const accounts = await listOAuthAccountsByOwner(NOTION_PROVIDER, owner);
  if (accounts.length === 0) return null;
  const account = accounts[0];
  const tokens = (await getOAuthTokens(
    NOTION_PROVIDER,
    account.accountId,
  )) as NotionTokens | null;
  if (!tokens?.access_token) return null;
  return {
    accountId: account.accountId,
    tokens,
    accessToken: tokens.access_token,
    workspaceName: tokens.workspace_name || null,
    workspaceId: tokens.workspace_id || null,
  };
}

export async function disconnectNotionForOwner(owner: string) {
  if (process.env.NOTION_API_KEY) {
    delete process.env.NOTION_API_KEY;
    try {
      const path = await import("path");
      const { upsertEnvFile } = await import(
        "@agent-native/core/server" as string
      );
      const envPath = path.join(process.cwd(), ".env");
      await (upsertEnvFile as Function)(envPath, [
        { key: "NOTION_API_KEY", value: "" },
      ]);
    } catch {
      // Edge runtime — skip file write
    }
    return 1;
  }

  const accounts = await listOAuthAccountsByOwner(NOTION_PROVIDER, owner);
  let deleted = 0;
  for (const account of accounts) {
    deleted += await deleteOAuthTokens(NOTION_PROVIDER, account.accountId);
  }
  return deleted;
}

export function buildNotionAuthUrl(event: H3Event, redirectPath = "/"): string {
  const clientId = process.env.NOTION_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "Notion OAuth credentials are not configured. Set NOTION_CLIENT_ID and NOTION_CLIENT_SECRET.",
    );
  }
  const redirectUri = `${getOrigin(event)}/api/notion/callback`;
  const state = encodeState({ redirectPath });
  const params = new URLSearchParams({
    owner: "user",
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });
  return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
}

export function getNotionRedirectPath(stateParam: string | undefined): string {
  const state = decodeState(stateParam);
  return state.redirectPath || "/";
}

export async function exchangeNotionCodeForTokens(
  event: H3Event,
  code: string,
): Promise<NotionTokens> {
  const redirectUri = `${getOrigin(event)}/api/notion/callback`;
  const response = await fetch(`${NOTION_API_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: notionBasicAuthHeader(),
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
  return accountId;
}
