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
        const seqCols = rowIndex === 0 ? row.length : MAX_COLUMNS_PER_ROW;
        const rowStyle = { "--seq-cols": seqCols } as React.CSSProperties;
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
