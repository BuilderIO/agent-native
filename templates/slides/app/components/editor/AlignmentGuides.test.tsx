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
  });
});
