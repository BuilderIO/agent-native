import type { ReplaceStep, Step } from "@tiptap/pm/transform";

export function isReplaceStep(step: Step): step is ReplaceStep {
  return step.toJSON().stepType === "replace";
}
