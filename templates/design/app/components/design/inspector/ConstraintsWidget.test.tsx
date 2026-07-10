import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConstraintsWidget } from "./ConstraintsWidget";

describe("ConstraintsWidget mixed selections", () => {
  it("renders an explicit Mixed value for each mixed axis", () => {
    const markup = renderToStaticMarkup(
      createElement(ConstraintsWidget, {
        value: { horizontal: "mixed", vertical: "mixed" },
        onChange: () => undefined,
      }),
    );

    expect(markup.match(/Mixed/g)?.length).toBeGreaterThanOrEqual(2);
    expect(markup).toContain('aria-label="Horizontal"');
    expect(markup).toContain('aria-label="Vertical"');
  });
});
