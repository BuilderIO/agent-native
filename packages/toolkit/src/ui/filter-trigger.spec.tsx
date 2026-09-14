// @vitest-environment happy-dom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FilterTriggerIndicator } from "./filter-trigger.js";

function render(active: boolean): string {
  return renderToStaticMarkup(
    createElement(
      FilterTriggerIndicator,
      { active },
      createElement("svg", { key: "icon" }),
    ),
  );
}

describe("FilterTriggerIndicator", () => {
  it("marks the trigger when a filter narrows the list", () => {
    const markup = render(true);

    expect(markup).toContain('data-filter-active="true"');
    expect(markup).toContain("data-filter-active-dot");
    expect(markup).toContain("bg-primary");
  });

  it("renders no indicator when nothing is filtered", () => {
    const markup = render(false);

    expect(markup).toContain('data-filter-active="false"');
    expect(markup).not.toContain("data-filter-active-dot");
  });
});
