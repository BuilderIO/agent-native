import { designSystemReferenceSchema } from "@agent-native/core/shared/design-system-authoring";
import { z } from "zod";

export const ComposerSourceSchema = z.object({
  source: z.enum(["design", "slides", "figma"]),
  id: z.string().min(1),
  title: z.string().min(1),
  url: z.string().optional(),
  figmaUrl: z.string().optional(),
  nodeId: z.string().optional(),
});

export const SlidesComposerContextSchema = z.object({
  designSystemId: z.string().nullable(),
  designSystemRef: designSystemReferenceSchema.nullable().optional(),
  references: z.array(ComposerSourceSchema).max(20),
});

export type ComposerSource = z.infer<typeof ComposerSourceSchema>;
export type SlidesComposerContext = z.infer<typeof SlidesComposerContextSchema>;

export function composerSourceKey(source: ComposerSource): string {
  return `${source.source}:${source.id}:${source.nodeId ?? ""}`;
}
