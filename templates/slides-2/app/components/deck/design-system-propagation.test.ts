import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function readAppFile(relativePath: string) {
  return readFileSync(path.join(appRoot, relativePath), "utf8");
}

function expectsDesignSystemProp(source: string, componentName: string) {
  expect(source).toMatch(
    new RegExp(`<${componentName}\\b[^>]*\\bdesignSystem=\\{designSystem\\}[^>]*>`),
  );
}

describe("slide design-system propagation", () => {
  it("keeps preview and presentation renderers on the active deck tokens", () => {
    expectsDesignSystemProp(
      // source-read-ok: the route and preview component graph must pass deck design tokens to each renderer.
      readAppFile("components/editor/EditorSidebar.tsx"),
      "SlideRenderer",
    );
    expectsDesignSystemProp(
      // source-read-ok: the route and preview component graph must pass deck design tokens to each renderer.
      readAppFile("components/editor/GeneratingSlidePreview.tsx"),
      "SlideRenderer",
    );
    expectsDesignSystemProp(
      // source-read-ok: the route and preview component graph must pass deck design tokens to each renderer.
      readAppFile("components/presentation/PresentationView.tsx"),
      "SlideRenderer",
    );
    expectsDesignSystemProp(
      // source-read-ok: the route and preview component graph must pass deck design tokens to each renderer.
      readAppFile("components/presentation/PresenterView.tsx"),
      "SlideRenderer",
    );
    // source-read-ok: the route and preview component graph must pass deck design tokens to each renderer.
    expectsDesignSystemProp(
      // source-read-ok: the standalone preview route delegates rendering to the shared wrapper.
      readAppFile("routes/slide.tsx"),
      "SlideContentRenderer",
    );
    expectsDesignSystemProp(
      // source-read-ok: the shared wrapper must keep deck tokens on its HTML renderer branch.
      readAppFile("components/slides-2-runtime/SlideContentRenderer.tsx"),
      "SlideRenderer",
    );

    // source-read-ok: the route and preview component graph must pass deck design tokens to each renderer.
    const deckEditorSource = readAppFile("pages/DeckEditor.tsx");
    expectsDesignSystemProp(deckEditorSource, "EditorSidebar");
    expectsDesignSystemProp(deckEditorSource, "GeneratingSlidePreview");
    // source-read-ok: the route and preview component graph must pass deck design tokens to each renderer.
    expectsDesignSystemProp(readAppFile("pages/Presentation.tsx"), "View");

    // source-read-ok: the route and preview component graph must pass deck design tokens to each renderer.
    const sharedPresentationSource = readAppFile(
      "pages/SharedPresentation.tsx",
    );
    expect(sharedPresentationSource).toContain("deck.designSystem");
    expectsDesignSystemProp(sharedPresentationSource, "PresentationView");
  });
});
