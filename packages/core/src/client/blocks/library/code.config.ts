import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";


export interface CodeData {
  code: string;
  language?: string;
  filename?: string;
  caption?: string;
  maxLines?: number;
}

export const codeSchema = z.object({
  code: z.string().max(100_000),
  language: z.string().trim().max(40).optional(),
  filename: z.string().trim().max(400).optional(),
  caption: z.string().trim().max(400).optional(),
  maxLines: z.number().int().min(0).max(2000).optional(),
}) as unknown as z.ZodType<CodeData>;

export const codeMdx: BlockMdxConfig<CodeData> = {
  tag: "Code",
  toAttrs: (data) => ({
    filename: data.filename,
    language: data.language,
    caption: data.caption,
    maxLines: data.maxLines,
    code: data.code,
  }),
  fromAttrs: (attrs) => ({
    code: attrs.string("code") ?? "",
    language: attrs.string("language"),
    filename: attrs.string("filename"),
    caption: attrs.string("caption"),
    maxLines: attrs.number("maxLines"),
  }),
};
