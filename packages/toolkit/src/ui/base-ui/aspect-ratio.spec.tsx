// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AspectRatio } from "./aspect-ratio.js";

afterEach(cleanup);

describe("Aspect Ratio part", () => {
  it("is square unless given a ratio", () => {
    render(<AspectRatio data-testid="box" />);
    const box = screen.getByTestId("box");
    expect(box.className).toBe("aspect-ratio");
    expect(box.style.getPropertyValue("--aspect-ratio")).toBe("1");
  });

  it("writes its ratio beside the caller's own style", () => {
    render(
      <AspectRatio data-testid="box" ratio={16 / 9} style={{ maxWidth: 320 }}>
        <img alt="Preview" />
      </AspectRatio>,
    );
    const box = screen.getByTestId("box");
    expect(Number(box.style.getPropertyValue("--aspect-ratio"))).toBeCloseTo(
      16 / 9,
    );
    expect(box.style.maxWidth).toBe("320px");
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses a ratio of %s instead of drawing a square",
    (ratio) => {
      expect(() => render(<AspectRatio ratio={ratio} />)).toThrow(
        /is not a positive number/,
      );
    },
  );
});
