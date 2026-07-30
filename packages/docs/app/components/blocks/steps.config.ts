import type { BlockMdxConfig } from "@agent-native/core/blocks";
import { z } from "zod";

export interface StepItem {
  title: string;
  body: string;
}

export interface StepsData {
  steps: StepItem[];
}

export const stepsSchema = z.object({
  steps: z
    .array(z.object({ title: z.string(), body: z.string() }))
    .min(1)
    .max(20),
}) as unknown as z.ZodType<StepsData>;

export function parseStepsFromMarkdown(children: string): StepItem[] {
  const parts = children.split(/\n(?=###\s)/);
  const steps: StepItem[] = [];
  for (const part of parts) {
    const match = part.match(/^###\s+(.+?)\n([\s\S]*)$/);
    if (!match) continue;
    const title = match[1].trim();
    const body = match[2].trim();
    if (title) steps.push({ title, body });
  }
  return steps;
}

export function serializeStepsToMarkdown(steps: StepItem[]): string {
  return steps.map((s) => `### ${s.title}\n\n${s.body}`).join("\n\n");
}

export const stepsMdx: BlockMdxConfig<StepsData> = {
  tag: "Steps",
  childrenField: "steps" as never,
  toAttrs: () => ({}),
  fromAttrs: (_attrs, children) => ({
    steps: parseStepsFromMarkdown(children),
  }),
  serializeChildren: (data) => serializeStepsToMarkdown(data.steps),
};
