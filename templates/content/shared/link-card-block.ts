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

const RAW_TAG = /<LinkCard\b[^>]*?\/>/g;
const RAW_APP = /\sapp="([a-z]+)"/;
const RAW_QUOTED_URL = /(?<=\surl=")[^"]*(?=")/;
const RAW_JSON_URL = /(?<=\surl=\{\s*)"(?:[^"\\\n]|\\.)*"(?=\s*\})/;

function unescapeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function rawUrl(tag: string): string | null {
  const quoted = RAW_QUOTED_URL.exec(tag)?.[0];
  if (quoted !== undefined) return unescapeAttr(quoted);
  const json = RAW_JSON_URL.exec(tag)?.[0];
  if (json === undefined) return null;
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === "string" ? value : null;
    // coercion-ok: a tag whose link isn't a JSON string names no card, and callers keep its source as is
  } catch {
    return null;
  }
}

export function linkCardDataFromRaw(raw: unknown): LinkCardData | null {
  if (typeof raw !== "string") return null;
  const tag = raw.trim();
  if (!tag.startsWith(`<${LINK_CARD_TAG}`) || !tag.endsWith("/>")) return null;
  const app = RAW_APP.exec(tag)?.[1];
  const url = rawUrl(tag);
  if (!isLinkSummaryApp(app) || url === null) return null;
  return readLinkCardData({ app, url });
}

export function linkCardMarkdownLink(url: string): string {
  const label = url.replace(/[[\]\\]/g, (char) => `\\${char}`);
  const href = url.replace(/\(/g, "%28").replace(/\)/g, "%29");
  return `[${label}](${href})`;
}

export function linkCardsAsPlainLinks(markdown: string): string {
  if (!markdown.includes(`<${LINK_CARD_TAG}`)) return markdown;
  let inFence = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line.replace(RAW_TAG, (tag) => {
        const card = linkCardDataFromRaw(tag);
        return card ? linkCardMarkdownLink(card.url) : tag;
      });
    })
    .join("\n");
}
