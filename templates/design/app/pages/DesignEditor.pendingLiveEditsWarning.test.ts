import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

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

    const messages = readFileSync(
      new URL("../i18n-data.ts", import.meta.url),
      "utf8",
    );
    expect(messages).toContain('applyDesignUpdates: "Apply design update"');
  });

  it("clears the pending state after Apply and explicit discard", () => {
    const source = readFileSync(
      new URL("./DesignEditor.tsx", import.meta.url),
      "utf8",
    );
    const applyHandler = source.slice(
      source.indexOf("const handleApplyPendingVisualStylesWithAgent"),
      source.indexOf("const handleAbortPendingVisualStyles"),
    );
    const discardHandler = source.slice(
      source.indexOf("const handleAbortPendingVisualStyles"),
      source.indexOf("const handleCopyPendingVisualStylePrompt"),
    );

    expect(applyHandler).toContain("clearPendingLiveEditState()");
    expect(discardHandler).toContain("clearPendingLiveEditState()");
  });
});
