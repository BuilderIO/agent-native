import { describe, expect, it } from "vitest";

import {
  effectiveRelativePositionOffset,
  readRelativePositionStyles,
} from "./relative-position-offset";

it("reads current relative insets and the nearest supported containing block direction", () => {
  type TestElement = { parentElement: TestElement | null };
  const block: TestElement = { parentElement: null };
  const contents: TestElement = { parentElement: block };
  const inline: TestElement = { parentElement: contents };
  const selected: TestElement = { parentElement: inline };
  const styles = new Map<
    TestElement,
    {
      position: string;
      left: string;
      right: string;
      top: string;
      bottom: string;
      zIndex: string;
      display: string;
      direction: string;
    }
  >([
    [
      selected,
      {
        position: "relative",
        left: "40.25px",
        right: "7.75px",
        top: "12.5px",
        bottom: "9.25px",
        zIndex: "auto",
        display: "inline-block",
        direction: "ltr",
      },
    ],
    [
      inline,
      {
        position: "static",
        left: "auto",
        right: "auto",
        top: "auto",
        bottom: "auto",
        zIndex: "auto",
        display: "inline",
        direction: "ltr",
      },
    ],
    [
      contents,
      {
        position: "static",
        left: "auto",
        right: "auto",
        top: "auto",
        bottom: "auto",
        zIndex: "auto",
        display: "contents",
        direction: "ltr",
      },
    ],
    [
      block,
      {
        position: "static",
        left: "auto",
        right: "auto",
        top: "auto",
        bottom: "auto",
        zIndex: "auto",
        display: "block",
        direction: "rtl",
      },
    ],
  ]);

  expect(
    readRelativePositionStyles(selected, (element) => styles.get(element)!),
  ).toEqual({
    computedStyles: {
      position: "relative",
      left: "40.25px",
      right: "7.75px",
      top: "12.5px",
      bottom: "9.25px",
      zIndex: "auto",
    },
    relativeContainingBlockDirection: "rtl",
  });
});

it("leaves relative containing-block direction unavailable when display is unsupported", () => {
  type TestElement = { parentElement: TestElement | null };
  const ancestor: TestElement = { parentElement: null };
  const selected: TestElement = { parentElement: ancestor };
  const styles = new Map<
    TestElement,
    {
      position: string;
      left: string;
      right: string;
      top: string;
      bottom: string;
      zIndex: string;
      display: string;
      direction: string;
    }
  >([
    [
      selected,
      {
        position: "relative",
        left: "40px",
        right: "auto",
        top: "12px",
        bottom: "auto",
        zIndex: "auto",
        display: "block",
        direction: "ltr",
      },
    ],
    [
      ancestor,
      {
        position: "static",
        left: "auto",
        right: "auto",
        top: "auto",
        bottom: "auto",
        zIndex: "auto",
        display: "table-row",
        direction: "rtl",
      },
    ],
  ]);

  expect(
    readRelativePositionStyles(selected, (element) => styles.get(element)!),
  ).toMatchObject({ relativeContainingBlockDirection: undefined });
});

describe("effective relative position offset", () => {
  it("uses the actual RTL parent's right inset when both horizontal sides are set", () => {
    expect(
      effectiveRelativePositionOffset(
        {
          left: "40.25px",
          right: "7.75px",
          top: "12.5px",
          bottom: "9.25px",
        },
        "rtl",
      ),
    ).toEqual({ x: -7.75, y: 12.5 });
  });

  it("uses the LTR parent's left inset when both horizontal sides are set", () => {
    expect(
      effectiveRelativePositionOffset(
        { left: "40.25px", right: "7.75px", top: "auto", bottom: "9px" },
        "ltr",
      ),
    ).toEqual({ x: 40.25, y: -9 });
  });

  it("resolves a single horizontal side without direction", () => {
    expect(
      effectiveRelativePositionOffset({
        left: "40px",
        right: "auto",
        top: "12px",
      }),
    ).toEqual({ x: 40, y: 12 });
    expect(
      effectiveRelativePositionOffset({
        left: "auto",
        right: "8px",
        top: "12px",
      }),
    ).toEqual({ x: -8, y: 12 });
  });

  it("refuses ambiguous or non-pixel opposing insets", () => {
    expect(
      effectiveRelativePositionOffset({
        left: "40px",
        right: "8px",
        top: "12px",
      }),
    ).toBeNull();
    expect(
      effectiveRelativePositionOffset(
        { left: "10%", right: "8px", top: "12px" },
        "rtl",
      ),
    ).toBeNull();
  });
});
