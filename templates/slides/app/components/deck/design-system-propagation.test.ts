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
    new RegExp(`<${componentName}\\b[\\s\\S]*?designSystem=\\{designSystem\\}`),
  );
}

describe("slide design-system propagation", () => {
  it("keeps preview and presentation renderers on the active deck tokens", () => {
    expectsDesignSystemProp(
      readAppFile("components/editor/EditorSidebar.tsx"),
      "SlideRenderer",
    );
    expectsDesignSystemProp(
      readAppFile("components/editor/GeneratingSlidePreview.tsx"),
      "SlideRenderer",
    );
    expectsDesignSystemProp(
      readAppFile("components/presentation/PresentationView.tsx"),
      "SlideRenderer",
    );
    expectsDesignSystemProp(
      readAppFile("components/presentation/PresenterView.tsx"),
      "SlideRenderer",
    );
    expectsDesignSystemProp(readAppFile("routes/slide.tsx"), "SlideRenderer");

    const deckEditorSource = readAppFile("pages/DeckEditor.tsx");
    expectsDesignSystemProp(deckEditorSource, "EditorSidebar");
    expectsDesignSystemProp(deckEditorSource, "GeneratingSlidePreview");
    expectsDesignSystemProp(readAppFile("pages/Presentation.tsx"), "View");
  });
});
