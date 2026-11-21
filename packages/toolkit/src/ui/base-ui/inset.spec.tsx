// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Card } from "./card.js";
import { Inset, type InsetProps } from "./inset.js";

afterEach(cleanup);

describe("Inset part", () => {
  it("runs to every edge, clipped to the card's border, by default", () => {
    render(
      <Card>
        <Inset data-testid="inset">
          <img alt="Chart" />
        </Inset>
      </Card>,
    );
    const inset = screen.getByTestId("inset");
    expect(inset.className).toBe("inset");
    expect(inset.dataset.side).toBe("all");
    expect(inset.dataset.clip).toBe("border-box");
    expect(inset.parentElement?.classList.contains("card")).toBe(true);
  });

  it("writes the side and clip it is given", () => {
    render(<Inset data-testid="inset" side="top" clip="padding-box" />);
    const inset = screen.getByTestId("inset");
    expect(inset.dataset.side).toBe("top");
    expect(inset.dataset.clip).toBe("padding-box");
  });

  it("refuses a side it doesn't have", () => {
    const props = { side: "start" } as unknown as InsetProps;
    expect(() => render(<Inset {...props} />)).toThrow(
      /side="start" is not one of/,
    );
  });
});
