import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DefaultSpinner } from "./DefaultSpinner.js";

describe("DefaultSpinner theme styles", () => {
  it("uses the selected dark theme instead of the operating system preference", () => {
    const html = renderToStaticMarkup(<DefaultSpinner />);

    expect(html).toContain("html.dark");
    expect(html).toContain('html[data-theme="dark"]');
    expect(html).not.toContain("prefers-color-scheme");
  });
});
