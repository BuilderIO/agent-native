import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";

export type DiffMode = "unified" | "split";

export interface DiffAnnotation {
  side?: "before" | "after";
  lines: string;
  label?: string;
  note: string;
}

export interface DiffData {
  filename?: string;
  language?: string;
  before: string;
  after: string;
  mode?: DiffMode;
  annotations?: DiffAnnotation[];
}

const lineRefSchema = z
  .string()
  .trim()
  .regex(/^\d+(\s*-\s*\d+)?$/, {
    message: 'lines must be a 1-based line ref like "3" or "3-5"',
  })
  .max(40);

const diffAnnotationSchema = z.object({
  side: z.enum(["before", "after"]).optional(),
  lines: lineRefSchema,
  label: z.string().trim().max(160).optional(),
  note: z.string().trim().min(1).max(4_000),
}) as z.ZodType<DiffAnnotation>;

export const diffSchema = z.object({
  filename: z.string().trim().max(400).optional(),
  language: z.string().trim().max(40).optional(),
  before: z.string().max(100_000),
  after: z.string().max(100_000),
  mode: z.enum(["unified", "split"]).optional(),
  annotations: z.array(diffAnnotationSchema).max(80).optional(),
}) as unknown as z.ZodType<DiffData>;

export const diffMdx: BlockMdxConfig<DiffData> = {
  tag: "Diff",
  toAttrs: (data) => ({
    filename: data.filename,
    language: data.language,
    mode: data.mode,
    before: data.before,
    after: data.after,
    annotations: data.annotations,
  }),
  fromAttrs: (attrs) => ({
    filename: attrs.string("filename"),
    language: attrs.string("language"),
    mode: attrs.string("mode") as DiffMode | undefined,
    before: attrs.string("before") ?? "",
    after: attrs.string("after") ?? "",
    annotations: attrs.array<DiffAnnotation>("annotations"),
  }),
};
