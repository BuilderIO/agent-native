import { defineBlock } from "@agent-native/core/blocks";
import type { BlockReadProps } from "@agent-native/core/blocks";
import type React from "react";

import {
  comparisonSchema,
  comparisonMdx,
  type ComparisonData,
  type ComparisonSide,
} from "./comparison.config";

export type { ComparisonData };

/** Curated accent keys, matching Badge's color naming so authors reach for
 * the same word everywhere on the site. Each maps to a real theme token in
 * global.css (docs-comparison-col[data-accent-color]), not a raw hex, so it
 * stays correct in both themes. */
const ACCENT_COLOR_KEYS = new Set(["blue", "green", "red", "yellow"]);

/** Legacy heuristic: a bare "Before"/"After"-style label still gets an
 * accent with no explicit `color`, so every pre-existing Comparison in the
 * docs corpus keeps rendering exactly as before. */
const LEGACY_LABEL_ACCENT: Record<string, string> = {
  before: "red",
  old: "red",
  without: "red",
  after: "green",
  new: "green",
  with: "green",
};

function resolveAccentColor(side: ComparisonSide): string | undefined {
  if (side.color) {
    return ACCENT_COLOR_KEYS.has(side.color) ? side.color : undefined;
  }
  return LEGACY_LABEL_ACCENT[side.label.toLowerCase().trim()];
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
          className="docs-comparison-col"
          data-accent-color={resolveAccentColor(side)}
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
