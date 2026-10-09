// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AlignmentGuides } from "./AlignmentGuides";

describe("AlignmentGuides", () => {
  afterEach(cleanup);

  it("maps slide-coordinate guides into the rendered canvas viewport", () => {
    render(
      <AlignmentGuides
        guides={[
          { orientation: "vertical", position: 25, start: 0, end: 50 },
          { orientation: "horizontal", position: 10, start: 0, end: 100 },
        ]}
        viewport={{
          rect: { left: 10, top: 20, width: 200, height: 100 },
          canvas: { width: 100, height: 50 },
        }}
      />,
    );

    const vertical = document.querySelector<HTMLElement>(
      '[data-slide-alignment-guide="vertical"]',
    );
    const horizontal = document.querySelector<HTMLElement>(
      '[data-slide-alignment-guide="horizontal"]',
    );

    expect(vertical?.style.left).toBe("60px");
    expect(vertical?.style.top).toBe("20px");
    expect(vertical?.style.height).toBe("100px");
    expect(horizontal?.style.left).toBe("10px");
    expect(horizontal?.style.top).toBe("40px");
    expect(horizontal?.style.width).toBe("200px");
    expect(horizontal?.style.height).toBe("1px");
    for (const line of [vertical, horizontal]) {
      expect(line?.style.backgroundColor).toBe("#ff0000");
      expect(line?.style.boxShadow).toBe("");
    }
  });

  it("draws equal-spacing guides in blue", () => {
    render(
      <AlignmentGuides
        guides={[
          { orientation: "vertical", position: 25, start: 0, end: 50 },
          {
            orientation: "horizontal",
            position: 10,
            start: 20,
            end: 40,
            equalSpacing: true,
          },
        ]}
        viewport={{
          rect: { left: 0, top: 0, width: 100, height: 50 },
          canvas: { width: 100, height: 50 },
        }}
      />,
    );

    const red = document.querySelector<HTMLElement>(
      '[data-slide-alignment-guide="vertical"]',
    );
    const blue = document.querySelector<HTMLElement>(
      '[data-slide-guide-kind="equal-spacing"]',
    );
    expect(red?.style.backgroundColor).toBe("#ff0000");
    expect(blue?.style.backgroundColor).toBe("#009ef5");
    expect(blue?.style.height).toBe("1px");
  });
});
