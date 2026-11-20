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
    const groups: Array<string | undefined> = [...match];
    const [, name, double, single, expression] = groups;
    if (name === undefined || attrs.has(name)) continue;
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

export function linkCardsAsPlainLinks(markdown: string): string {
  if (!markdown.includes(`<${LINK_CARD_TAG}`)) return markdown;
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
