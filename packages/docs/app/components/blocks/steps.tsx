import { defineBlock } from "@agent-native/core/blocks";
import type { BlockReadProps } from "@agent-native/core/blocks";

import { stepsSchema, stepsMdx, type StepsData } from "./steps.config";

export type { StepsData };

export function StepsBlock({ data, ctx }: BlockReadProps<StepsData>) {
  return (
    <ol className="docs-steps" aria-label="Steps">
      {data.steps.map((step, i) => (
        <li key={i} className="docs-step">
          <div className="docs-step-aside" aria-hidden="true">
            <span className="docs-step-number">{i + 1}</span>
            {i < data.steps.length - 1 && (
              <span className="docs-step-connector" />
            )}
          </div>
          <div className="docs-step-content">
            <p className="docs-step-title">{step.title}</p>
            {step.body
              ? (ctx.renderMarkdown?.(step.body) ?? (
                  <div className="docs-step-body">{step.body}</div>
                ))
              : null}
          </div>
        </li>
      ))}
    </ol>
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
