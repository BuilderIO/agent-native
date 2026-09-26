import { z } from "zod";

export const composerWebsiteUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  }, "Enter a valid HTTP or HTTPS URL without credentials.");

export const composerSourceRequestSchema = z
  .object({
    source: z
      .enum(["design", "slides", "figma", "website"])
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
    url: composerWebsiteUrlSchema
      .optional()
      .describe("Public website URL; required for a website read."),
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
  })
  .superRefine((value, ctx) => {
    if (value.source !== "website") return;
    if (!value.url)
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "A website URL is required.",
      });
    if (value.operation !== "read")
      ctx.addIssue({
        code: "custom",
        path: ["operation"],
        message: "Website context supports read only.",
      });
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
