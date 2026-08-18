import { defineBlock } from "@agent-native/core/blocks";
import type { BlockReadProps } from "@agent-native/core/blocks";
import type React from "react";

import {
  comparisonSchema,
  comparisonMdx,
  type ComparisonData,
} from "./comparison.config";

export type { ComparisonData };

const ACCENT_CLASSES: Record<string, string> = {
  before: "docs-comparison-col--before",
  after: "docs-comparison-col--after",
  old: "docs-comparison-col--before",
  new: "docs-comparison-col--after",
  without: "docs-comparison-col--before",
  with: "docs-comparison-col--after",
};

function accentClass(label: string): string {
  return ACCENT_CLASSES[label.toLowerCase().trim()] ?? "";
}

export function ComparisonBlock({ data, ctx }: BlockReadProps<ComparisonData>) {
  return (
    <div
      className="docs-comparison"
      style={{ "--comparison-cols": data.sides.length } as React.CSSProperties}
    >
      {data.sides.map((side, i) => (
        <div
          key={i}
          className={`docs-comparison-col ${accentClass(side.label)}`}
        >
          <p className="docs-comparison-label">{side.label}</p>
          <div className="docs-comparison-body">
            {ctx.renderMarkdown?.(side.body) ?? <p>{side.body}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

export const comparisonBlock = defineBlock<ComparisonData>({
  type: "comparison",
  schema: comparisonSchema,
  mdx: comparisonMdx,
  Read: ComparisonBlock,
  placement: ["block"],
  label: "Comparison",
  description:
    "A side-by-side comparison of two to four options, e.g. Before/After or Option A/Option B.",
  empty: () => ({
    sides: [
      { label: "Before", body: "The old approach." },
      { label: "After", body: "The new approach." },
    ],
  }),
});
