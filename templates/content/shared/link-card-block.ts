import {
  defineBlock,
  serializeSpecBlock,
  type BlockMdxConfig,
  type BlockSpec,
} from "@agent-native/core/blocks/server";
import {
  LINK_SUMMARY_APPS,
  isLinkSummaryApp,
  parseLinkSummaryUrl,
  type LinkSummaryApp,
} from "@agent-native/core/shared";
import { z } from "zod";

export const LINK_CARD_BLOCK_TYPE = "link-card";
export const LINK_CARD_TAG = "LinkCard";

export interface LinkCardData {
  app: LinkSummaryApp;
  url: string;
}

export const linkCardSchema = z.object({
  app: z.enum(LINK_SUMMARY_APPS),
  url: z
    .string()
    .refine(
      (value) => value === value.trim() && parseLinkSummaryUrl(value) !== null,
      "A link card holds one http(s) link.",
    ),
}) as unknown as z.ZodType<LinkCardData>;

export const linkCardMdx: BlockMdxConfig<LinkCardData> = {
  tag: LINK_CARD_TAG,
  toAttrs: (data) => ({ app: data.app, url: data.url }),
  fromAttrs: (attrs) => ({
    app: (attrs.string("app") ?? "") as LinkSummaryApp,
    url: attrs.string("url") ?? "",
  }),
};

const ServerReadStub = () => null;

export const linkCardBlockConfig: BlockSpec<LinkCardData> =
  defineBlock<LinkCardData>({
    type: LINK_CARD_BLOCK_TYPE,
    schema: linkCardSchema,
    mdx: linkCardMdx,
    Read: ServerReadStub,
    placement: ["block"],
    label: "Link card",
    description:
      'A link to a Design, Slides deck, or Clips recording shown as a card with the item\'s title for readers who can open it. Stores only the app ("design", "slides", or "clips") and the link; never write a title into it.',
  });

export function readLinkCardData(data: unknown): LinkCardData | null {
  const parsed = linkCardSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function linkCardBlockRaw(blockId: string, data: LinkCardData): string {
  return serializeSpecBlock(linkCardBlockConfig, { id: blockId, data });
}

// One MDX attribute: a bare name, "text", 'text' or an {expression}.
const RAW_ATTR =
  /\s+([A-Za-z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^{}]*)\}))?/y;

function unescapeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function expressionString(expression: string): string | null {
  try {
    const value: unknown = JSON.parse(expression);
    return typeof value === "string" ? value : null;
    // coercion-ok: an expression that isn't a JSON string names no value, and callers keep the tag as is
  } catch {
    return null;
  }
}

/**
 * A self-closing LinkCard tag's attributes, read in order the way the MDX
 * parser reads them (the first of a repeated name wins), or null when the tag
 * holds anything else.
 */
function rawAttrs(tag: string): Map<string, string | null> | null {
  const open = `<${LINK_CARD_TAG}`;
  if (!tag.startsWith(open)) return null;
  const attrs = new Map<string, string | null>();
  let at = open.length;
  for (;;) {
    RAW_ATTR.lastIndex = at;
    const match = RAW_ATTR.exec(tag);
    if (!match) break;
    at = RAW_ATTR.lastIndex;
    const [, name, double, single, expression] = match;
    if (attrs.has(name)) continue;
    attrs.set(
      name,
      double !== undefined
        ? unescapeAttr(double)
        : single !== undefined
          ? unescapeAttr(single)
          : expression !== undefined
            ? expressionString(expression.trim())
            : null,
    );
  }
  return /^\s*\/>$/.test(tag.slice(at)) ? attrs : null;
}

export function linkCardDataFromRaw(raw: unknown): LinkCardData | null {
  if (typeof raw !== "string") return null;
  const attrs = rawAttrs(raw.trim());
  const app = attrs?.get("app");
  const url = attrs?.get("url");
  if (!isLinkSummaryApp(app) || typeof url !== "string") return null;
  return readLinkCardData({ app, url });
}

export function linkCardMarkdownLink(url: string): string {
  const label = url.replace(/[[\]\\]/g, (char) => `\\${char}`);
  const href = url.replace(/\(/g, "%28").replace(/\)/g, "%29");
  return `[${label}](${href})`;
}

const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;

/**
 * Turns each card in a page body into its plain link, for exports. A card is a
 * block, alone on its line; a tag inside a sentence, inline code or a fenced
 * code block is text and stays as written.
 */
export function linkCardsAsPlainLinks(markdown: string): string {
  if (!markdown.includes(`<${LINK_CARD_TAG}`)) return markdown;
  // A fence closes only on a run of its own character at least as long.
  let fence: string | null = null;
  return markdown
    .split("\n")
    .map((line) => {
      if (fence !== null) {
        const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line)?.[1];
        if (close && close[0] === fence[0] && close.length >= fence.length) {
          fence = null;
        }
        return line;
      }
      const open = FENCE_OPEN.exec(line)?.[1];
      if (open) {
        fence = open;
        return line;
      }
      const card = linkCardDataFromRaw(line);
      if (!card) return line;
      const indent = /^\s*/.exec(line)?.[0] ?? "";
      return `${indent}${linkCardMarkdownLink(card.url)}`;
    })
    .join("\n");
}
