import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  "app/pages/design-editor/domains/use-editor-active-screen-and-geometry.ts",
  "utf8",
);

describe("frame geometry save failures", () => {
  const catchBlock = source.slice(
    source.indexOf("await saveDesignDataAsync(outboxEntry.payload"),
    source.indexOf("frameGeometryMutationChainRef.current = current;"),
  );

  it("only claims a reconnect retry for an offline failure", () => {
    expect(catchBlock).toContain("classifyDesignSaveFailure(");
    expect(catchBlock).toMatch(
      /=== "offline"\s*\)\s*\{\s*warnChangesWillRetry\(\);/,
    );
  });

  it("reports a refused write instead of calling it a lost connection", () => {
    expect(catchBlock).toContain("designSaveErrorMessage(error)");
    expect(catchBlock).toContain("toast.error(");
  });
});

describe("widget first-paint writes", () => {
  const filesSource = readFileSync(
    "app/pages/design-editor/domains/use-editor-files-and-saving.ts",
    "utf8",
  );

  it("does not start the board migration inside a widget grant that refuses it", () => {
    const effect = filesSource.slice(
      filesSource.indexOf("migrateBoardTriggeredRef = useRef"),
      filesSource.indexOf("const openGenerateInAgent"),
    );
    expect(effect).toContain("widgetEmbed");
    expect(effect).toMatch(
      /if \(!id \|\| !canEditDesign \|\| shellMode \|\| widgetEmbed\)/,
    );
  });
});

describe("widget open framing", () => {
  const canvasSource = readFileSync(
    "app/pages/design-editor/domains/use-editor-canvas-and-screens.ts",
    "utf8",
  );

  it("refits once when the opened screen's breakpoint heights are first measured", () => {
    expect(canvasSource).toContain("widgetOpenFitRef");
    expect(canvasSource).toMatch(
      /widgetOpenFitRef\.current = \{[^}]*signature: breakpointHeightsSignature/s,
    );
    // Any wheel or pointer input keeps the user's own camera.
    expect(canvasSource).toMatch(/addEventListener\("wheel", release[^)]*\)/);
  });
});
