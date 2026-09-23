import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import enUSMessages from "../i18n/en-US";

describe("DesignEditor pending live edits", () => {
  it("keeps the Apply split button minimal", () => {
    const source = readFileSync(
      new URL("./DesignEditor.tsx", import.meta.url),
      "utf8",
    );
    const toolbarStart = source.indexOf(
      "data-design-pending-visual-style-toolbar",
    );
    const toolbar = source.slice(
      toolbarStart,
      source.indexOf("{viewMode ===", toolbarStart),
    );

    expect(toolbar).toContain(
      '"designEditor.pendingVisualStyles.applyDesignUpdates"',
    );
    expect(toolbar).not.toContain("sessionOnlyWarning");
    expect(toolbar).not.toContain("{pendingVisualEditCount}");
    // The primary button's classes moved into `cn()` so the split-button
    // rounding can drop when the host shell hides the chevron.
    expect(toolbar).toContain('"h-9 min-w-0');
    expect(toolbar).toContain('className="h-9 w-8');
    expect(toolbar).not.toContain("h-11");
    expect(toolbar).toContain("publicVisualEdit");
    expect(toolbar).toContain("handleCopyPendingVisualStylePrompt");
    expect(toolbar).toContain("shellMode && canEditDesign");

    expect(
      enUSMessages.designEditor.pendingVisualStyles.applyDesignUpdates,
    ).toBe("Apply design update");
  });

  it("clears the pending state after Apply and explicit discard", () => {
    const source = readFileSync(
      new URL("./DesignEditor.tsx", import.meta.url),
      "utf8",
    );
    // The apply handler now lives in its own command module.
    const applyHandler = readFileSync(
      new URL(
        "./design-editor/commands/apply-pending-visual-styles-with-agent.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const discardHandler = source.slice(
      source.indexOf("const handleAbortPendingVisualStyles"),
      source.indexOf("const handleCopyPendingVisualStylePrompt"),
    );

    expect(applyHandler).toContain("clearPendingLiveEditState()");
    expect(discardHandler).toContain("clearPendingLiveEditState()");
  });

  it("keeps Escape in the preview menu from reaching editor hotkeys", () => {
    const source = readFileSync(
      new URL("./DesignEditor.tsx", import.meta.url),
      "utf8",
    );
    const menu = source.slice(
      source.indexOf("data-design-pending-visual-style-toolbar"),
      source.indexOf(
        "{viewMode ===",
        source.indexOf("data-design-pending-visual-style-toolbar"),
      ),
    );
    expect(menu).toContain("onEscapeKeyDown={(event) =>");
    expect(menu).toContain("event.stopPropagation()");
    expect(menu).toContain("onClick={handleAbortPendingVisualStyles}");
  });

  it("does not route public visual-edit viewers into the locked agent panel", () => {
    const source = readFileSync(
      new URL("./DesignEditor.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("data-design-public-agent-empty-state");
    expect(source).toContain("canEditDesign");
    expect(source).toContain("handleCopyPendingVisualStylePrompt");
    expect(source).toContain("publicVisualEdit");
  });

  it("publishes the handoff for agents that do not have the Design tab", () => {
    const source = readFileSync(
      new URL("./DesignEditor.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('callAction("publish-visual-edit-pending"');
    expect(source).toContain("pendingVisualStylePrompt");
  });
});
