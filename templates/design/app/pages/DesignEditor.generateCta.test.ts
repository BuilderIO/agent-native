import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The starting placeholder carries Generate. It used to disappear as soon as
 * any file existed — which is immediately — so a blank canvas lost the option
 * before the user could take it.
 */
const source = readFileSync(
  new URL("./DesignEditor.tsx", import.meta.url),
  "utf8",
);

describe("starting placeholder", () => {
  it("opens the agent and lands the caret in the chat", () => {
    const handler = source.slice(
      source.indexOf("const openGenerateInAgent = useCallback"),
      source.indexOf("const overviewScreens = useMemo"),
    );
    // Goes through agent-panel:open, which opens the panel AND focuses the
    // composer — a direct setActiveLeftPanel would open it with no caret.
    expect(handler).toContain('new Event("agent-panel:open")');
    expect(handler).not.toContain("handlePromptOpenChange(true)");
    expect(source).toContain("onClick={openGenerateInAgent}");
    const listener = source.slice(
      source.indexOf("const focusAgentComposer = () => {"),
      source.indexOf('window.addEventListener("agent-panel:open"'),
    );
    expect(listener).toContain("prosemirror.focus()");
  });

  it("survives until the design has content or a tool is picked", () => {
    expect(source).toContain(
      "{activeFile && (!designIsEmpty || canvasEngaged) ? (",
    );
    expect(source).toContain(
      "() => overviewScreens.length === 0 && (boardElements?.length ?? 0) === 0,",
    );
  });

  it("treats reaching for any non-default tool as the deliberate act", () => {
    expect(source).toContain(
      'if (activeTool !== "move") setCanvasEngaged(true);',
    );
  });

  it("adds no second Generate control beside the toolbar", () => {
    expect(source).not.toContain("data-design-generate-cta");
  });
});
