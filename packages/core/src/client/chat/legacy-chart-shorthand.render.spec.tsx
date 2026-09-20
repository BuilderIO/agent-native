import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  LegacyChartShorthandChart,
  parseLegacyChartShorthand,
} from "./legacy-chart-shorthand.js";

function render(line: string): string {
  const parsed = parseLegacyChartShorthand(line);
  if (!parsed) throw new Error(`expected shorthand to parse: ${line}`);
  return renderToStaticMarkup(
    createElement(LegacyChartShorthandChart, { parsed }),
  );
}

describe("LegacyChartShorthandChart rendering", () => {
  it("renders a visible circle marker for a single-label line chart instead of a zero-length polyline", () => {
    const html = render('/chart type=line labels=["Now"] data=[5]');

    expect(html).toContain("<circle");
    expect(html).not.toContain("<polyline");
  });

  it("renders a visible circle marker for a single-label area chart", () => {
    const html = render('/chart type=area labels=["Now"] data=[5]');

    expect(html).toContain("<circle");
    expect(html).not.toContain("<polyline");
    expect(html).not.toContain("<polygon");
  });

  it("renders a polyline (not a circle) for a multi-label line chart", () => {
    const html = render('/chart type=line labels=["Mon","Tue"] data=[5,8]');

    expect(html).toContain("<polyline");
    expect(html).not.toContain("<circle");
  });
});
