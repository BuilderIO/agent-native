import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";


export interface HtmlBlockData {
  html: string;
  css?: string;
  caption?: string;
}

const unsafeHtmlPattern =
  /(?:<!doctype|<\/?(?:html|head|body|script|style|iframe|object|embed|link|meta|base|form)[\s>/]|\b(?:javascript|data:text\/html)\s*:|\bsrcdoc\s*=|\bon[a-z][\w:-]*\s*=)/i;

const noFullHtmlDocument = (value: string) => !unsafeHtmlPattern.test(value);

export const htmlSchema = z
  .object({
    html: z.string().max(100_000).refine(noFullHtmlDocument, {
      message:
        "Custom HTML blocks must be bounded fragments without html/head/body/script/style tags.",
    }),
    css: z
      .string()
      .max(50_000)
      .refine(noFullHtmlDocument, {
        message: "Custom CSS blocks must not include document or script tags.",
      })
      .optional(),
    caption: z.string().trim().max(400).optional(),
  })
  .strict() as unknown as z.ZodType<HtmlBlockData>;

export const htmlMdx: BlockMdxConfig<HtmlBlockData> = {
  tag: "HtmlBlock",
  toAttrs: (data) => ({
    html: data.html,
    css: data.css,
    caption: data.caption,
  }),
  fromAttrs: (attrs) => ({
    html: attrs.string("html") ?? "",
    css: attrs.string("css"),
    caption: attrs.string("caption"),
  }),
};
