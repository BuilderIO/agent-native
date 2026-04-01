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
  children?: NotionBlock[];
  [key: string]: any;
};

type NotionPage = {
  id: string;
  icon?: { type: string; emoji?: string } | null;
  last_edited_time?: string;
  properties?: Record<string, any>;
  parent?: Record<string, any>;
};

const LIST_BLOCK_TYPES = new Set([
  "bulleted_list_item",
  "numbered_list_item",
  "to_do",
  "toggle",
]);
const TOGGLE_MARKER = "▶";
const TOGGLE_MARKER_OPEN = "▾";
const VISUAL_INDENT = "\u00A0\u00A0";

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

function splitMarkdownLines(text: string, indent = ""): string[] {
  return text.split("\n").map((line) => (line ? `${indent}${line}` : ""));
}

function visualIndent(level: number): string {
  return VISUAL_INDENT.repeat(level);
}

function isListBlock(block: NotionBlock | undefined): boolean {
  return !!block && LIST_BLOCK_TYPES.has(block.type);
}

function shouldInsertBlankLine(
  previous: NotionBlock | undefined,
  current: NotionBlock,
): boolean {
  if (!previous) return false;
  return !(isListBlock(previous) && isListBlock(current));
}

function isPlainTextCodeLanguage(language: string): boolean {
  return ["", "plain text", "text", "plain"].includes(
    language.trim().toLowerCase(),
  );
}

function looksLikeCode(text: string): boolean {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return false;

  // If average words per line is high, it's likely prose not code
  const totalWords = lines.reduce((sum, l) => sum + l.split(/\s+/).length, 0);
  if (totalWords / lines.length > 8) return false;

  let signalCount = 0;
  for (const line of lines) {
    if (
      /^[<{[]/.test(line) ||
      /[{}[\];]/.test(line) ||
      /\b(const|let|var|function|class|return|import|export|async|await|if|else|for|while|switch|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\b/.test(
        line,
      ) ||
      // Function call: word( — requires NO space before paren and followed by ; { or EOL
      /\w+\([^)]*\)(?:\s*[;{]|$)/.test(line)
    ) {
      signalCount++;
    }
  }

  // Require at least half the lines to look like code (stricter than before)
  return signalCount >= Math.max(2, Math.ceil(lines.length / 2));
}

function codeBlockToMarkdown(block: NotionBlock, indent: string): string[] {
  const language = String(block.code?.language || "").trim();
  const text = richTextToPlain(block.code?.rich_text || []);

  if (isPlainTextCodeLanguage(language) && !looksLikeCode(text)) {
    return splitMarkdownLines(text, indent);
  }

  return [
    `${indent}\`\`\`${language}`.trimEnd(),
    ...text.split("\n").map((line) => `${indent}${line}`),
    `${indent}\`\`\``,
  ];
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

type ParsedLine =
  | { kind: "blank"; indent: number }
  | { kind: "code-fence"; indent: number; language: string }
  | { kind: "divider"; indent: number }
  | { kind: "heading"; indent: number; level: number; text: string }
  | { kind: "todo"; indent: number; text: string; checked: boolean }
  | { kind: "bullet"; indent: number; text: string }
  | { kind: "numbered"; indent: number; text: string }
  | { kind: "quote"; indent: number; text: string }
  | { kind: "toggle"; indent: number; text: string }
  | { kind: "paragraph"; indent: number; text: string };

function getLineIndent(rawLine: string): { indent: number; text: string } {
  let index = 0;
  let indent = 0;

  while (index < rawLine.length) {
    if (rawLine.startsWith(VISUAL_INDENT, index)) {
      indent++;
      index += VISUAL_INDENT.length;
      continue;
    }
    if (rawLine.startsWith("  ", index)) {
      indent++;
      index += 2;
      continue;
    }
    if (rawLine[index] === "\t") {
      indent++;
      index += 1;
      continue;
    }
    break;
  }

  return {
    indent,
    text: rawLine.slice(index),
  };
}

function parseMarkdownLine(rawLine: string): ParsedLine {
  const { indent, text } = getLineIndent(rawLine);
  const trimmed = text.trim();

  if (!trimmed) return { kind: "blank", indent };

  if (/^```/.test(trimmed)) {
    return {
      kind: "code-fence",
      indent,
      language: trimmed.slice(3).trim() || "plain text",
    };
  }
  if (/^---+$/.test(trimmed)) return { kind: "divider", indent };

  const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
  if (headingMatch) {
    return {
      kind: "heading",
      indent,
      level: headingMatch[1].length,
      text: headingMatch[2],
    };
  }

  const todoMatch = trimmed.match(/^[-*]\s+\[( |x)\]\s+(.*)$/i);
  if (todoMatch) {
    return {
      kind: "todo",
      indent,
      checked: todoMatch[1].toLowerCase() === "x",
      text: todoMatch[2],
    };
  }

  const toggleMatch = trimmed.match(/^(?:[-*]\s+)?(?:▶|▾)\s+(.*)$/);
  if (toggleMatch) {
    return { kind: "toggle", indent, text: toggleMatch[1] };
  }

  const bulletMatch = trimmed.match(/^[-*]\s+(.*)$/);
  if (bulletMatch) {
    return { kind: "bullet", indent, text: bulletMatch[1] };
  }

  const numberedMatch = trimmed.match(/^\d+\.\s+(.*)$/);
  if (numberedMatch) {
    return { kind: "numbered", indent, text: numberedMatch[1] };
  }

  const quoteMatch = trimmed.match(/^>\s?(.*)$/);
  if (quoteMatch) {
    return { kind: "quote", indent, text: quoteMatch[1] };
  }

  return { kind: "paragraph", indent, text };
}

function makeNotionBlockFromParsedLine(
  line: Exclude<ParsedLine, { kind: "blank" } | { kind: "code-fence" }>,
) {
  switch (line.kind) {
    case "divider":
      return { object: "block", type: "divider", divider: {} };
    case "heading": {
      const key =
        line.level === 1
          ? "heading_1"
          : line.level === 2
            ? "heading_2"
            : "heading_3";
      return {
        object: "block",
        type: key,
        [key]: { rich_text: markdownInlineToRichText(line.text) },
      };
    }
    case "todo":
      return {
        object: "block",
        type: "to_do",
        to_do: {
          checked: line.checked,
          rich_text: markdownInlineToRichText(line.text),
        },
      };
    case "bullet":
      return {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: markdownInlineToRichText(line.text) },
      };
    case "numbered":
      return {
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: markdownInlineToRichText(line.text) },
      };
    case "quote":
      return {
        object: "block",
        type: "quote",
        quote: { rich_text: markdownInlineToRichText(line.text) },
      };
    case "toggle":
      return {
        object: "block",
        type: "toggle",
        toggle: { rich_text: markdownInlineToRichText(line.text) },
      };
    case "paragraph":
      return paragraphBlock(line.text);
  }
}

export function markdownToNotionBlocks(markdown: string): any[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: any[] = [];
  const blockStack: any[] = [];

  function attachBlock(indent: number, block: any) {
    if (indent <= 0) {
      blocks.push(block);
      blockStack.length = 0;
      blockStack[0] = block;
      return;
    }

    const parent = blockStack[indent - 1];
    if (!parent) {
      blocks.push(block);
      blockStack.length = 0;
      blockStack[0] = block;
      return;
    }

    parent.children ||= [];
    parent.children.push(block);
    blockStack.length = indent;
    blockStack[indent] = block;
  }

  for (let i = 0; i < lines.length; i++) {
    const parsed = parseMarkdownLine(lines[i]);

    if (parsed.kind === "blank") continue;

    if (parsed.kind === "code-fence") {
      const codeLines: string[] = [];
      i++;
      while (
        i < lines.length &&
        parseMarkdownLine(lines[i]).kind !== "code-fence"
      ) {
        const { text } = getLineIndent(lines[i]);
        codeLines.push(text);
        i++;
      }
      attachBlock(parsed.indent, {
        object: "block",
        type: "code",
        code: {
          language: parsed.language,
          rich_text: [
            { type: "text", text: { content: codeLines.join("\n") } },
          ],
        },
      });
      continue;
    }

    if (parsed.kind === "paragraph" && parsed.indent === 0) {
      const paragraphLines = [parsed.text];
      while (i + 1 < lines.length) {
        const next = parseMarkdownLine(lines[i + 1]);
        if (next.kind !== "paragraph" || next.indent !== 0) {
          break;
        }
        paragraphLines.push(next.text);
        i++;
      }
      attachBlock(0, paragraphBlock(paragraphLines.join(" ")));
      continue;
    }

    attachBlock(parsed.indent, makeNotionBlockFromParsedLine(parsed as any));
  }

  return blocks.length > 0 ? blocks : [paragraphBlock("")];
}

function childrenToMarkdown(
  children: NotionBlock[] | undefined,
  warnings: string[],
  indent: string,
): string[] {
  if (!children?.length) return [];
  const lines: string[] = [];
  let previousChild: NotionBlock | undefined;
  for (const child of children) {
    const childLines = blockToMarkdown(child, warnings, indent);
    if (childLines.length === 0) continue;
    if (shouldInsertBlankLine(previousChild, child)) {
      lines.push("");
    }
    lines.push(...childLines);
    previousChild = child;
  }
  return trimTrailingBlankLines(lines);
}

function nestedParagraphChildrenToMarkdown(
  children: NotionBlock[],
  warnings: string[],
  depth: number,
): string[] {
  const lines: string[] = [];
  for (const child of children) {
    if (child.type === "paragraph") {
      const childText = richTextToMarkdown(child.paragraph?.rich_text || []);
      if (childText) {
        lines.push(...splitMarkdownLines(childText, visualIndent(depth)));
      }
      if (child.children?.length) {
        lines.push(
          ...nestedParagraphChildrenToMarkdown(
            child.children,
            warnings,
            depth + 1,
          ),
        );
      }
    } else if (child.type === "toggle") {
      const toggleText = richTextToMarkdown(child.toggle?.rich_text || []);
      lines.push(`${visualIndent(depth)}${TOGGLE_MARKER} ${toggleText}`);
      if (child.children?.length) {
        lines.push(
          ...nestedParagraphChildrenToMarkdown(
            child.children,
            warnings,
            depth + 1,
          ),
        );
      }
    } else {
      lines.push(...blockToMarkdown(child, warnings, "  ".repeat(depth)));
    }
  }
  return lines;
}

function blockToMarkdown(
  block: NotionBlock,
  warnings: string[],
  indent = "",
): string[] {
  const childIndent = indent + "  ";
  const lines: string[] = [];

  switch (block.type) {
    case "paragraph":
      lines.push(
        ...splitMarkdownLines(
          richTextToMarkdown(block.paragraph?.rich_text || []),
          indent,
        ),
      );
      break;
    case "heading_1":
      lines.push(`# ${richTextToMarkdown(block.heading_1?.rich_text || [])}`);
      break;
    case "heading_2":
      lines.push(`## ${richTextToMarkdown(block.heading_2?.rich_text || [])}`);
      break;
    case "heading_3":
      lines.push(`### ${richTextToMarkdown(block.heading_3?.rich_text || [])}`);
      break;
    case "bulleted_list_item":
      lines.push(
        `${indent}- ${richTextToMarkdown(block.bulleted_list_item?.rich_text || [])}`,
      );
      break;
    case "numbered_list_item":
      lines.push(
        `${indent}1. ${richTextToMarkdown(block.numbered_list_item?.rich_text || [])}`,
      );
      break;
    case "to_do":
      lines.push(
        `${indent}- [${block.to_do?.checked ? "x" : " "}] ${richTextToMarkdown(block.to_do?.rich_text || [])}`,
      );
      break;
    case "quote":
      lines.push(`> ${richTextToMarkdown(block.quote?.rich_text || [])}`);
      break;
    case "divider":
      lines.push("---");
      break;
    case "code":
      lines.push(...codeBlockToMarkdown(block, indent));
      break;
    case "callout":
      warnings.push("Flattened Notion callout block into markdown quote.");
      lines.push(`> ${richTextToMarkdown(block.callout?.rich_text || [])}`);
      break;
    case "toggle":
      lines.push(
        `${indent}${TOGGLE_MARKER} ${richTextToMarkdown(block.toggle?.rich_text || [])}`,
      );
      break;
    case "image": {
      warnings.push("Image blocks were omitted from markdown sync.");
      return [];
    }
    default: {
      warnings.push(`Unsupported Notion block type omitted: ${block.type}.`);
      return [];
    }
  }

  if (block.children?.length) {
    if (block.type === "paragraph" || block.type === "toggle") {
      lines.push(
        ...nestedParagraphChildrenToMarkdown(
          block.children,
          warnings,
          indent ? Math.floor(indent.length / 2) + 1 : 1,
        ),
      );
    } else {
      lines.push(...childrenToMarkdown(block.children, warnings, childIndent));
    }
  }

  return lines;
}

export function notionBlocksToMarkdown(blocks: NotionBlock[]): {
  markdown: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  const lines: string[] = [];
  let previousBlock: NotionBlock | undefined;

  for (const block of blocks) {
    const blockLines = blockToMarkdown(block, warnings);
    if (blockLines.length === 0) continue;
    if (shouldInsertBlankLine(previousBlock, block)) {
      lines.push("");
    }
    lines.push(...blockLines);
    previousBlock = block;
  }

  return {
    markdown: trimTrailingBlankLines(lines).join("\n"),
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

export async function fetchBlockChildrenDeep(
  accessToken: string,
  blockId: string,
): Promise<NotionBlock[]> {
  const blocks = await fetchBlockChildren(accessToken, blockId);
  await Promise.all(
    blocks
      .filter((b) => b.has_children)
      .map(async (b) => {
        b.children = await fetchBlockChildrenDeep(accessToken, b.id);
      }),
  );
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
  const blocks = await fetchBlockChildrenDeep(accessToken, pageId);
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
