import {
  defineBlock,
  serializeSpecBlock,
  type BlockMdxConfig,
  type BlockSpec,
} from "@agent-native/core/blocks/server";
import {
  parseLinkSummaryUrl,
  type LinkSummaryApp,
} from "@agent-native/core/shared";
import { z } from "zod";

export const LINK_CARD_BLOCK_TYPE = "link-card";
export const LINK_CARD_TAG = "LinkCard";

export const LINK_CARD_APPS = [
  "design",
  "slides",
  "clips",
] as const satisfies readonly LinkSummaryApp[];
export type LinkCardApp = (typeof LINK_CARD_APPS)[number];

export function isLinkCardApp(value: unknown): value is LinkCardApp {
  return (
    typeof value === "string" &&
    (LINK_CARD_APPS as readonly string[]).includes(value)
  );
}

export interface LinkCardData {
  app: LinkCardApp;
  url: string;
}

export const linkCardSchema = z.object({
  app: z.enum(LINK_CARD_APPS),
  url: z
    .string()
    .refine(
      (value) => !/\s/.test(value) && parseLinkSummaryUrl(value) !== null,
      "A link card holds one http(s) link that carries no token or key.",
    ),
}) as unknown as z.ZodType<LinkCardData>;

export const linkCardMdx: BlockMdxConfig<LinkCardData> = {
  tag: LINK_CARD_TAG,
  toAttrs: (data) => ({ app: data.app, url: data.url }),
  fromAttrs: (attrs) => ({
    app: (attrs.string("app") ?? "") as LinkCardApp,
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
      'A link to a Design, Slides deck, or Clips recording shown as a card with the item\'s title for readers who can open it. Stores only the app ("design", "slides", or "clips") and the link; never write a title into it. Keep a link that carries a token or key as a plain link.',
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

const RAW_OPEN = `<${LINK_CARD_TAG}`;
const RAW_CLOSE = /\s*\/>[^\S\n]*(?=\n|$)/y;

function readCardTag(
  text: string,
  start: number,
): { data: LinkCardData | null; end: number } | null {
  if (!text.startsWith(RAW_OPEN, start)) return null;
  const attrs = new Map<string, string | null>();
  let at = start + RAW_OPEN.length;
  for (;;) {
    RAW_ATTR.lastIndex = at;
    const match = RAW_ATTR.exec(text);
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
  RAW_CLOSE.lastIndex = at;
  if (!RAW_CLOSE.test(text)) return null;
  const app = attrs.get("app");
  const url = attrs.get("url");
  return {
    data:
      isLinkCardApp(app) && typeof url === "string"
        ? readLinkCardData({ app, url })
        : null,
    end: RAW_CLOSE.lastIndex,
  };
}

export function linkCardDataFromRaw(raw: unknown): LinkCardData | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  const tag = readCardTag(text, 0);
  return tag?.end === text.length ? tag.data : null;
}

function percentEncoded(text: string, characters: RegExp): string {
  return text.replace(
    characters,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function linkCardMarkdownLink(url: string): string {
  const label = percentEncoded(url, /[[\]\\]/g);
  const href = percentEncoded(url, /[()]/g);
  return `[${label}](${href})`;
}

const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;

export function linkCardsAsPlainLinks(markdown: string): string {
  if (!markdown.includes(RAW_OPEN)) return markdown;
  const out: string[] = [];
  let fence: string | null = null;
  for (let start = 0; start <= markdown.length; ) {
    const newline = markdown.indexOf("\n", start);
    let end = newline < 0 ? markdown.length : newline;
    let line = markdown.slice(start, end);
    if (fence !== null) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) {
        fence = null;
      }
    } else {
      fence = FENCE_OPEN.exec(line)?.[1] ?? null;
      const indent = /^\t*/.exec(line)?.[0] ?? "";
      const card = readCardTag(markdown, start + indent.length);
      if (card?.data) {
        line = `${indent}${linkCardMarkdownLink(card.data.url)}`;
        end = card.end;
      }
    }
    out.push(line);
    start = end + 1;
  }
  return out.join("\n");
}
