import { z } from "zod";

export const composerSourceRequestSchema = z.object({
  source: z
    .enum(["design", "slides", "figma"])
    .describe("Source app or provider to browse."),
  operation: z
    .enum(["list", "read"])
    .describe("List available references or read one selected reference."),
  search: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe("Optional title search within this source."),
  id: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe(
      "Selected design or deck id; required when reading an app reference.",
    ),
  figmaUrl: z
    .string()
    .trim()
    .max(2048)
    .optional()
    .describe("Figma file or selection URL; required for Figma references."),
  nodeId: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe(
      "Optional Figma frame id; otherwise use the selection in figmaUrl.",
    ),
  page: z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(1)
    .describe("One-based Design or Figma result page; defaults to 1."),
  cursor: z
    .string()
    .max(512)
    .optional()
    .describe("Opaque Slides continuation cursor from a prior result."),
});

const sourceItem = z.object({
  id: z.string().min(1).max(200),
  title: z.string().max(2000),
  url: z.string().max(2048).optional(),
  updatedAt: z.string().max(100).optional(),
});

export const composerSourceListSchema = z.object({
  items: z.array(sourceItem).max(50),
  hasMore: z.boolean(),
  nextCursor: z.string().max(512).optional(),
});
export const composerSourceReferenceSchema = sourceItem.extend({
  context: z.string().min(1).max(20000),
});
export const composerSourceResultSchema = z.union([
  composerSourceListSchema,
  composerSourceReferenceSchema,
]);

export type ComposerSourceRequest = z.infer<typeof composerSourceRequestSchema>;
export type ComposerSourceResult = z.infer<typeof composerSourceResultSchema>;
