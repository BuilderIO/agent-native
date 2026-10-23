import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PoweredByBadge } from "./PoweredByBadge.js";

describe("PoweredByBadge theme styles", () => {
  it("follows the selected theme classes and data attribute", () => {
    const html = renderToStaticMarkup(<PoweredByBadge />);

    expect(html).toContain("html.dark");
    expect(html).toContain('html[data-theme="dark"]');
    expect(html).toContain("html.light");
    expect(html).toContain('html[data-theme="light"]');
    expect(html).not.toContain("prefers-color-scheme");
  });
});
