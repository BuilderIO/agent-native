import { defineBlock } from "@agent-native/toolkit/app/blocks";
import type { BlockReadProps } from "@agent-native/toolkit/app/blocks";
import {
  NumberedSteps,
  NumberedStep,
  NumberedStepTitle,
  NumberedStepBody,
} from "@agent-native/toolkit/ui/numbered-steps";

import { stepsSchema, stepsMdx, type StepsData } from "./steps.config";

export type { StepsData };

export function StepsBlock({ data, ctx }: BlockReadProps<StepsData>) {
  return (
    <NumberedSteps className="docs-steps" aria-label="Steps">
      {data.steps.map((step, i) => (
        <NumberedStep key={i} number={i + 1} last={i === data.steps.length - 1}>
          <NumberedStepTitle asChild>
            <p>{step.title}</p>
          </NumberedStepTitle>
          {step.body ? (
            <NumberedStepBody>
              {ctx.renderMarkdown?.(step.body) ?? step.body}
            </NumberedStepBody>
          ) : null}
        </NumberedStep>
      ))}
    </NumberedSteps>
  );
}

export const stepsBlock = defineBlock<StepsData>({
  type: "steps",
  schema: stepsSchema,
  mdx: stepsMdx,
  Read: StepsBlock,
  placement: ["block"],
  label: "Steps",
  description: "A numbered step-by-step procedure with circled step numbers.",
  empty: () => ({ steps: [{ title: "Step title", body: "Step body." }] }),
});
