import { useState } from "react";

import { LayoutDimensions } from "../../src/ui/base-ui/layout-properties.js";

const widths = Array.from({ length: 100 }, (_, index) => 10 + index);

/** Exercises the public control with 100 inexpensive painted rectangles and a mixed starting value. */
export function PropertyScrubBaseline() {
  const [width, setWidth] = useState<number | null>(null);
  const [committed, setCommitted] = useState<number | null>(null);
  return (
    <>
      <div style={{ width: 280 }}>
        <LayoutDimensions
          width={width}
          height={8}
          locked={false}
          onLockChange={() => {}}
          onEdit={(event) => {
            if (event.phase === "cancel") setWidth(committed);
            else {
              setWidth(event.value.value);
              if (event.phase === "commit") setCommitted(event.value.value);
            }
          }}
        />
        <button
          disabled={committed === null}
          onClick={() => {
            setCommitted(null);
            setWidth(null);
          }}
        >
          Undo
        </button>
      </div>
      <div
        role="region"
        aria-label="Design canvas"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(10,120px)",
          gap: 4,
        }}
      >
        {widths.map((initial, index) => (
          <button
            key={index}
            aria-label={"Layer " + index}
            data-layer-id={index}
            aria-pressed="true"
            style={{
              width: width ?? initial,
              height: 8,
              background: "currentColor",
              border: 0,
              padding: 0,
            }}
          />
        ))}
      </div>
    </>
  );
}
