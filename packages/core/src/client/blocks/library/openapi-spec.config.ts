import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";


export interface OpenApiSpecData {
  spec: string;
  title?: string;
}

export const openApiSpecSchema = z.object({
  spec: z.string().max(400_000),
  title: z.string().trim().max(200).optional(),
}) as unknown as z.ZodType<OpenApiSpecData>;

export const openApiSpecMdx: BlockMdxConfig<OpenApiSpecData> = {
  tag: "OpenApi",
  toAttrs: (data) => ({
    title: data.title,
    spec: data.spec,
  }),
  fromAttrs: (attrs) => ({
    spec: attrs.string("spec") ?? "",
    title: attrs.string("title"),
  }),
};
