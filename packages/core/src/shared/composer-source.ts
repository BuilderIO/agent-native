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
    .describe("Title search within this source."),
  id: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe("Selected design or deck id for a read."),
  figmaUrl: z
    .string()
    .trim()
    .max(2048)
    .optional()
    .describe("Figma file or selection URL."),
  nodeId: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe("Selected Figma frame id."),
  page: z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(1)
    .describe("One-based result page; defaults to 1."),
  cursor: z
    .string()
    .max(512)
    .optional()
    .describe("Opaque continuation cursor from a prior result."),
});

const sourceItem = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const composerSourceResultSchema = z.union([
  z.object({
    items: z.array(sourceItem).max(1000),
    hasMore: z.boolean().optional(),
    nextCursor: z.string().optional(),
  }),
  sourceItem.extend({ context: z.string().min(1).max(20000) }),
]);

export type ComposerSourceRequest = z.infer<typeof composerSourceRequestSchema>;
export type ComposerSourceResult = z.infer<typeof composerSourceResultSchema>;
