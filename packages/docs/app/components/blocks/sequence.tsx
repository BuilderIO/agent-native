import { defineBlock } from "@agent-native/core/blocks";
import type { BlockReadProps } from "@agent-native/core/blocks";
import { Fragment } from "react";
import type React from "react";

import {
  groupSequenceRows,
  MAX_COLUMNS_PER_ROW,
  sequenceSchema,
  sequenceMdx,
  type SequenceData,
} from "./sequence.config";

export type { SequenceData };

/** Same accent keys as Comparison, so authors reach for the same word. */
const ACCENT_COLOR_KEYS = new Set(["blue", "green", "red", "yellow"]);

function resolveAccent(accent?: string): string | undefined {
  return accent && ACCENT_COLOR_KEYS.has(accent) ? accent : undefined;
}

export function SequenceBlock({ data, ctx }: BlockReadProps<SequenceData>) {
  const rows = groupSequenceRows(data.items);
  let counter = 0;
  let previousSeqCols = 0;

  return (
    <div className="docs-sequence" role="list" aria-label="Sequence">
      {rows.map((row, rowIndex) => {
        // Every row stretches to fill the width, using a grid column count
        // that's either the row's own item count (row 0 — sized to a short
        // 1-3 item sequence, or however an author intentionally split it)
        // or always MAX_COLUMNS_PER_ROW (every later row), regardless of how
        // many cards actually landed there. Fixing the column count for
        // every row after the first keeps a card's horizontal position
        // predictable across wraps instead of shifting per row.
        const seqCols = rowIndex === 0 ? row.length : MAX_COLUMNS_PER_ROW;
        const rowStyle = { "--seq-cols": seqCols } as React.CSSProperties;
        // The elbow points at the horizontal center of the card it's
        // connecting, not the row's raw edge — its "from" side depends on
        // how many columns the row above actually used (only variable for
        // row 0), its "to" side is always a fixed MAX_COLUMNS_PER_ROW grid
        // (hardcoded in the CSS itself, since every row past the first
        // always uses it).
        const elbowStyle =
          rowIndex > 0
            ? ({ "--seq-prev-cols": previousSeqCols } as React.CSSProperties)
            : undefined;
        previousSeqCols = seqCols;

        return (
          <Fragment key={rowIndex}>
            {rowIndex > 0 && (
              <div
                className="docs-sequence-elbow"
                aria-hidden="true"
                style={elbowStyle}
              >
                <span className="docs-sequence-elbow-down-right" />
                <span className="docs-sequence-elbow-line" />
                <span className="docs-sequence-elbow-down-left" />
              </div>
            )}
            <div
              className="docs-sequence-row docs-sequence-row--grid"
              style={rowStyle}
            >
              {row.map((item, i) => {
                counter += 1;
                const number = counter;
                // An under-filled trailing row (fewer cards than seqCols)
                // otherwise leaves its last card in a single fixed-width
                // track with the rest of the row blank — span it through the
                // row's remaining, otherwise-empty tracks instead.
                const isLastInRow = i === row.length - 1;
                const cardStyle: React.CSSProperties | undefined =
                  isLastInRow && row.length < seqCols
                    ? { gridColumn: "auto / -1" }
                    : undefined;
                return (
                  <Fragment key={i}>
                    {i > 0 && (
                      <span className="docs-sequence-arrow" aria-hidden="true">
                        &rarr;
                      </span>
                    )}
                    <div
                      className="docs-sequence-card"
                      role="listitem"
                      data-accent={resolveAccent(item.accent)}
                      style={cardStyle}
                    >
                      <span className="docs-sequence-number">{number}.</span>{" "}
                      <div className="docs-sequence-text">
                        {ctx.renderMarkdown?.(item.text) ?? <p>{item.text}</p>}
                      </div>
                    </div>
                  </Fragment>
                );
              })}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

export const sequenceBlock = defineBlock<SequenceData>({
  type: "sequence",
  schema: sequenceSchema,
  mdx: sequenceMdx,
  Read: SequenceBlock,
  placement: ["block"],
  label: "Sequence",
  description:
    "A connected sequence of short event cards, e.g. how a request flows step by step. Rows cap at three cards and wrap with an elbow connector once a fourth card is added. Prefix a card's heading with `:blue:`/`:green:`/`:red:`/`:yellow:` to accent the one card that matters.",
  empty: () => ({
    items: [
      { text: "**First** thing happens" },
      { text: "**Then** this happens" },
      { text: "**Finally** this happens" },
    ],
  }),
});
