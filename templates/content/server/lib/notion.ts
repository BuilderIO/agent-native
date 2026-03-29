import crypto from "node:crypto";
import {
  deleteOAuthTokens,
  getOAuthTokens,
  listOAuthAccountsByOwner,
  saveOAuthTokens,
} from "@agent-native/core/oauth-tokens";
import { getSession } from "@agent-native/core/server";
import type { H3Event } from "h3";

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

type NotionRichText = {
  plain_text?: string;
  text?: { content?: string };
  annotations?: { bold?: boolean; italic?: boolean; strikethrough?: boolean };
};

type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: any;
};

type NotionPage = {
  id: string;
  icon?: { type: string; emoji?: string } | null;
  last_edited_time?: string;
  properties?: Record<string, any>;
  parent?: Record<string, any>;
};

export type NotionPageContent = {
  pageId: string;
  title: string;
  icon: string | null;
  content: string;
  lastEditedTime: string | null;
  warnings: string[];
};

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

function richTextToPlain(parts: NotionRichText[] | undefined): string {
  return (parts || []).map((part) => part.plain_text || "").join("");
}

function trimTrailingBlankLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end--;
  return lines.slice(0, end);
}

function markdownInlineToRichText(text: string) {
  if (!text) return [{ type: "text", text: { content: "" } }];

  const segments: Array<{
    type: "text";
    text: { content: string };
    annotations?: { bold?: boolean; italic?: boolean; strikethrough?: boolean };
  }> = [];

  const tokenRegex = /(\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~)/g;
  let lastIndex = 0;
  for (const match of text.matchAll(tokenRegex)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      segments.push({
        type: "text",
        text: { content: text.slice(lastIndex, start) },
      });
    }
    const value = match[0];
    if (value.startsWith("**")) {
      segments.push({
        type: "text",
        text: { content: value.slice(2, -2) },
        annotations: { bold: true },
      });
    } else if (value.startsWith("~~")) {
      segments.push({
        type: "text",
        text: { content: value.slice(2, -2) },
        annotations: { strikethrough: true },
      });
    } else {
      segments.push({
        type: "text",
        text: { content: value.slice(1, -1) },
        annotations: { italic: true },
      });
    }
    lastIndex = start + value.length;
  }
  if (lastIndex < text.length) {
    segments.push({
      type: "text",
      text: { content: text.slice(lastIndex) },
    });
  }
  return segments.length > 0
    ? segments
    : [{ type: "text", text: { content: text } }];
}

function richTextToMarkdown(parts: NotionRichText[] | undefined): string {
  return (parts || [])
    .map((part) => {
      const text = part.plain_text || part.text?.content || "";
      if (!text) return "";
      if (part.annotations?.bold) return `**${text}**`;
      if (part.annotations?.italic) return `*${text}*`;
      if (part.annotations?.strikethrough) return `~~${text}~~`;
      return text;
    })
    .join("");
}

function paragraphBlock(text: string) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: markdownInlineToRichText(text),
    },
  };
}

export function markdownToNotionBlocks(markdown: string): any[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: any[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) continue;

    if (/^```/.test(trimmed)) {
      const language = trimmed.slice(3).trim() || "plain text";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({
        object: "block",
        type: "code",
        code: {
          language,
          rich_text: [
            { type: "text", text: { content: codeLines.join("\n") } },
          ],
        },
      });
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push({ object: "block", type: "divider", divider: {} });
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const key =
        level === 1 ? "heading_1" : level === 2 ? "heading_2" : "heading_3";
      blocks.push({
        object: "block",
        type: key,
        [key]: {
          rich_text: markdownInlineToRichText(headingMatch[2]),
        },
      });
      continue;
    }

    const todoMatch = trimmed.match(/^[-*]\s+\[( |x)\]\s+(.*)$/i);
    if (todoMatch) {
      blocks.push({
        object: "block",
        type: "to_do",
        to_do: {
          checked: todoMatch[1].toLowerCase() === "x",
          rich_text: markdownInlineToRichText(todoMatch[2]),
        },
      });
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: markdownInlineToRichText(bulletMatch[1]),
        },
      });
      continue;
    }

    const numberedMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (numberedMatch) {
      blocks.push({
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: {
          rich_text: markdownInlineToRichText(numberedMatch[1]),
        },
      });
      continue;
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      blocks.push({
        object: "block",
        type: "quote",
        quote: {
          rich_text: markdownInlineToRichText(quoteMatch[1]),
        },
      });
      continue;
    }

    const paragraphLines = [trimmed];
    while (i + 1 < lines.length) {
      const next = lines[i + 1].trim();
      if (
        !next ||
        /^#{1,3}\s/.test(next) ||
        /^[-*]\s+\[( |x)\]\s+/i.test(next) ||
        /^[-*]\s+/.test(next) ||
        /^\d+\.\s+/.test(next) ||
        /^>\s?/.test(next) ||
        /^```/.test(next) ||
        /^---+$/.test(next)
      ) {
        break;
      }
      paragraphLines.push(next);
      i++;
    }
    blocks.push(paragraphBlock(paragraphLines.join(" ")));
  }

  return blocks.length > 0 ? blocks : [paragraphBlock("")];
}

function blockToMarkdown(
  block: NotionBlock,
  warnings: string[],
  indent = "",
): string[] {
  switch (block.type) {
    case "paragraph":
      return [indent + richTextToMarkdown(block.paragraph?.rich_text || [])];
    case "heading_1":
      return [`# ${richTextToMarkdown(block.heading_1?.rich_text || [])}`];
    case "heading_2":
      return [`## ${richTextToMarkdown(block.heading_2?.rich_text || [])}`];
    case "heading_3":
      return [`### ${richTextToMarkdown(block.heading_3?.rich_text || [])}`];
    case "bulleted_list_item":
      return [
        `${indent}- ${richTextToMarkdown(block.bulleted_list_item?.rich_text || [])}`,
      ];
    case "numbered_list_item":
      return [
        `${indent}1. ${richTextToMarkdown(block.numbered_list_item?.rich_text || [])}`,
      ];
    case "to_do":
      return [
        `${indent}- [${block.to_do?.checked ? "x" : " "}] ${richTextToMarkdown(block.to_do?.rich_text || [])}`,
      ];
    case "quote":
      return [`> ${richTextToMarkdown(block.quote?.rich_text || [])}`];
    case "divider":
      return ["---"];
    case "code":
      return [
        `\`\`\`${block.code?.language || ""}`.trimEnd(),
        richTextToPlain(block.code?.rich_text || []),
        "```",
      ];
    case "callout":
      warnings.push("Flattened Notion callout block into markdown quote.");
      return [`> ${richTextToMarkdown(block.callout?.rich_text || [])}`];
    case "toggle":
      warnings.push("Flattened Notion toggle block into markdown bullet.");
      return [`- ${richTextToMarkdown(block.toggle?.rich_text || [])}`];
    case "image": {
      warnings.push("Image blocks were omitted from markdown sync.");
      return [];
    }
    default: {
      warnings.push(`Unsupported Notion block type omitted: ${block.type}.`);
      return [];
    }
  }
}

export function notionBlocksToMarkdown(blocks: NotionBlock[]): {
  markdown: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  const lines = trimTrailingBlankLines(
    blocks.flatMap((block) => [...blockToMarkdown(block, warnings), ""]),
  );
  return {
    markdown: lines.join("\n"),
    warnings: [...new Set(warnings)],
  };
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
  const response = await fetch(`${NOTION_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Notion-Version": NOTION_API_VERSION,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      body?.message || `Notion request failed (${response.status})`,
    );
  }
  return body as T;
}

export async function fetchNotionPage(
  accessToken: string,
  pageId: string,
): Promise<NotionPage> {
  return notionFetch<NotionPage>(`/pages/${pageId}`, accessToken);
}

export async function fetchBlockChildren(
  accessToken: string,
  blockId: string,
): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let cursor: string | undefined;
  while (true) {
    const query = new URLSearchParams({ page_size: "100" });
    if (cursor) query.set("start_cursor", cursor);
    const result = await notionFetch<{
      results: NotionBlock[];
      has_more: boolean;
      next_cursor: string | null;
    }>(`/blocks/${blockId}/children?${query}`, accessToken);
    blocks.push(...result.results);
    if (!result.has_more || !result.next_cursor) break;
    cursor = result.next_cursor;
  }
  return blocks;
}

async function replaceChildren(
  accessToken: string,
  pageId: string,
  children: any[],
): Promise<void> {
  const existing = await fetchBlockChildren(accessToken, pageId);
  for (const block of existing) {
    await notionFetch(`/blocks/${block.id}`, accessToken, {
      method: "DELETE",
    });
  }

  for (let i = 0; i < children.length; i += 100) {
    const chunk = children.slice(i, i + 100);
    await notionFetch(`/blocks/${pageId}/children`, accessToken, {
      method: "PATCH",
      body: JSON.stringify({ children: chunk }),
    });
  }
}

export async function readNotionPageAsDocument(
  accessToken: string,
  pageId: string,
): Promise<NotionPageContent> {
  const page = await fetchNotionPage(accessToken, pageId);
  const blocks = await fetchBlockChildren(accessToken, pageId);
  const { markdown, warnings } = notionBlocksToMarkdown(blocks);
  return {
    pageId: page.id,
    title: extractPageTitle(page),
    icon: page.icon?.type === "emoji" ? page.icon.emoji || null : null,
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
  icon?: string | null;
}): Promise<NotionPageContent> {
  const page = await fetchNotionPage(args.accessToken, args.pageId);
  const titleKey = pageTitlePropertyName(page);
  const updateBody: Record<string, unknown> = {
    properties: {
      [titleKey]: {
        title: markdownInlineToRichText(args.title || "Untitled"),
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
  await replaceChildren(
    args.accessToken,
    args.pageId,
    markdownToNotionBlocks(args.content),
  );
  return readNotionPageAsDocument(args.accessToken, args.pageId);
}

export async function getDocumentOwnerEmail(event: H3Event): Promise<string> {
  const session = await getSession(event);
  return session?.email ?? "local@localhost";
}

/**
 * Returns the Notion API key if configured (internal integration).
 * This is the simple setup path — no OAuth needed.
 */
export function getNotionApiKey(): string | null {
  return process.env.NOTION_API_KEY || null;
}

export async function getNotionConnectionForOwner(owner: string) {
  // Simple path: internal integration API key
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

  // OAuth path: check stored tokens
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
  // Clear API key if that's how we're connected
  if (process.env.NOTION_API_KEY) {
    delete process.env.NOTION_API_KEY;
    // Also remove from .env file
    try {
      const path = await import("path");
      const { upsertEnvFile } = await import(
        "@agent-native/core/server" as string
      );
      const envPath = path.join(process.cwd(), ".env");
      (upsertEnvFile as Function)(envPath, [
        { key: "NOTION_API_KEY", value: "" },
      ]);
    } catch {
      // Edge runtime — skip file write
    }
    return 1;
  }

  // Clear OAuth tokens
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
  if (!accountId)
    throw new Error("Notion OAuth response missing workspace ID.");
  await saveOAuthTokens(
    NOTION_PROVIDER,
    accountId,
    tokens as Record<string, unknown>,
    owner,
  );
  return accountId;
}
