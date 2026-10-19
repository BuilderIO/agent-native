import { describe, expect, it } from "vitest";

import { getPreviewPatches } from "./preview-patches";

describe("getPreviewPatches", () => {
  it("keeps selected-range styles with their source text in the frame preview", () => {
    expect(
      getPreviewPatches([
        {
          line: 12,
          column: 4,
          ops: [
            { kind: "set-style", key: "color", value: "#222222" },
            {
              kind: "set-text-range-style",
              start: 2,
              end: 6,
              key: "fontSize",
              value: "32px",
              prevText: "A selected range",
            },
          ],
        },
      ]),
    ).toEqual([
      {
        line: 12,
        column: 4,
        styles: { color: "#222222" },
        rangeStyles: [
          {
            start: 2,
            end: 6,
            key: "fontSize",
            value: "32px",
            expectedText: "A selected range",
          },
        ],
      },
    ]);
  });

  it("omits ranges that cannot be mapped safely to the rendered text", () => {
    expect(
      getPreviewPatches([
        {
          line: 2,
          column: 0,
          ops: [
            {
              kind: "set-text-range-style",
              start: 0,
              end: 2,
              key: "backgroundImage",
              value: "unsupported",
              prevText: "Text",
            },
            {
              kind: "set-text-range-style",
              start: 0,
              end: 2,
              key: "color",
              value: "#123456",
            },
          ],
        },
      ]),
    ).toEqual([
      {
        line: 2,
        column: 0,
        styles: {},
      },
    ]);
  });
});
