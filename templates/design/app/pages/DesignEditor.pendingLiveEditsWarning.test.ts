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
    expect(toolbar).toContain('className="h-9 min-w-0');
    expect(toolbar).toContain('className="h-9 w-8');
    expect(toolbar).not.toContain('className="h-11');

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
});
