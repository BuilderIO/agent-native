import { z } from "zod";

import type { BlockMdxConfig } from "../types.js";

export interface AnnotatedCodeAnnotation {
  lines: string;
  label?: string;
  note: string;
}

export interface AnnotatedCodeData {
  filename?: string;
  language?: string;
  code: string;
  annotations?: AnnotatedCodeAnnotation[];
}

const lineRefSchema = z
  .string()
  .trim()
  .regex(/^\d+(\s*-\s*\d+)?$/, {
    message: 'lines must be a 1-based line ref like "3" or "3-5"',
  })
  .max(40);

const annotationSchema = z.object({
  lines: lineRefSchema,
  label: z.string().trim().max(160).optional(),
  note: z.string().trim().min(1).max(4_000),
}) as z.ZodType<AnnotatedCodeAnnotation>;

export const annotatedCodeSchema = z.object({
  filename: z.string().trim().max(400).optional(),
  language: z.string().trim().max(40).optional(),
  code: z.string().max(100_000),
  annotations: z.array(annotationSchema).max(80).optional(),
}) as unknown as z.ZodType<AnnotatedCodeData>;

export const annotatedCodeMdx: BlockMdxConfig<AnnotatedCodeData> = {
  tag: "AnnotatedCode",
  toAttrs: (data) => ({
    filename: data.filename,
    language: data.language,
    code: data.code,
    annotations: data.annotations,
  }),
  fromAttrs: (attrs) => ({
    filename: attrs.string("filename"),
    language: attrs.string("language"),
    code: attrs.string("code") ?? "",
    annotations: attrs.array<AnnotatedCodeAnnotation>("annotations") ?? [],
  }),
};
