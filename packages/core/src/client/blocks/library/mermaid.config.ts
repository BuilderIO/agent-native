import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";

export interface MermaidData {
  source: string;
  caption?: string;
}

export const mermaidSchema = z.object({
  source: z.string().max(50_000),
  caption: z.string().trim().max(400).optional(),
}) as unknown as z.ZodType<MermaidData>;

export const mermaidMdx: BlockMdxConfig<MermaidData> = {
  tag: "Mermaid",
  toAttrs: (data) => ({
    source: data.source,
    caption: data.caption,
  }),
  fromAttrs: (attrs) => ({
    source: attrs.string("source") ?? "",
    caption: attrs.string("caption"),
  }),
};
