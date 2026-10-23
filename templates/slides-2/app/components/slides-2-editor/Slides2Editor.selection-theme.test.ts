import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  EditorOverlayThemeProvider,
  useEditorOverlayThemeClassName,
} from "../editor/editor-overlay-theme";

const stylesheet = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../global.css"),
  "utf8",
);

describe("Slides-2 selection handles", () => {
  it("uses square dark handles inside the blue selection stroke", () => {
    const handleRule = stylesheet.match(
      /\.slides2-selection-handle\s*\{([^}]*)\}/,
    )?.[1];
    const outlineRule = stylesheet.match(
      /\.slides2-selection-outline\s*\{([^}]*)\}/,
    )?.[1];

    expect(handleRule).toMatch(
      /border-color:\s*hsl\(var\(--slides-selection-accent\)\)/,
    );
    expect(handleRule).toMatch(
      /background-color:\s*hsl\(var\(--slides-accent-foreground\)\)/,
    );
    expect(stylesheet).toMatch(/--slides-accent-foreground:\s*0 0% 10%/);
    expect(
      stylesheet.match(/--slides-selection-accent:\s*222 97% 63%/g),
    ).toHaveLength(2);
    expect(outlineRule).toMatch(
      /border-color:\s*hsl\(var\(--slides-selection-accent\)\)/,
    );
  });

  it("passes the editor theme to its portaled controls", () => {
    function OverlayThemeProbe() {
      return createElement("span", {
        className: useEditorOverlayThemeClassName(
          "focus-visible:outline-primary",
        ),
      });
    }

    const markup = renderToStaticMarkup(
      createElement(
        EditorOverlayThemeProvider,
        null,
        createElement(OverlayThemeProbe),
      ),
    );

    expect(markup).toContain('class="dark contents"');
    expect(markup).toContain('class="dark focus-visible:outline-primary"');
  });
});
