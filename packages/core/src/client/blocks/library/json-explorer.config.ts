import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";


export const JSON_EXPLORER_DEFAULT_COLLAPSED_DEPTH = 2;
export const JSON_EXPLORER_MAX_COLLAPSED_DEPTH = 20;

export interface JsonExplorerData {
  title?: string;
  json: string;
  collapsedDepth?: number;
}

export const jsonExplorerSchema = z.object({
  title: z.string().trim().max(200).optional(),
  json: z.string().max(200_000),
  collapsedDepth: z
    .number()
    .int()
    .min(0)
    .max(JSON_EXPLORER_MAX_COLLAPSED_DEPTH)
    .optional(),
}) as unknown as z.ZodType<JsonExplorerData>;

export const jsonExplorerMdx: BlockMdxConfig<JsonExplorerData> = {
  tag: "Json",
  toAttrs: (data) => ({
    title: data.title,
    json: data.json,
    collapsedDepth: data.collapsedDepth,
  }),
  fromAttrs: (attrs) => ({
    json: attrs.string("json") ?? "",
    title: attrs.string("title"),
    collapsedDepth: attrs.number("collapsedDepth"),
  }),
};
