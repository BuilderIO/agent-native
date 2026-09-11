import { describe, expect, it } from "vitest";

import { editorChromeBridgeScript } from "../../../.generated/bridge/editor-chrome.generated";

describe("programmatic text creation undo bridge", () => {
  it("cancels the native contenteditable session and forwards undo to host history", () => {
    const guard = editorChromeBridgeScript.indexOf(
      'programmaticTextEdit && metaOrCtrl && !ev.altKey && ev.key.toLowerCase() === "z"',
    );
    const cancel = editorChromeBridgeScript.indexOf("finish(false);", guard);
    const forward = editorChromeBridgeScript.indexOf(
      "postDesignHotkey(ev);",
      cancel,
    );

    expect(guard).toBeGreaterThan(-1);
    expect(cancel).toBeGreaterThan(guard);
    expect(forward).toBeGreaterThan(cancel);
  });

  it("reports an abandoned empty creation so the host removes the layer", () => {
    expect(editorChromeBridgeScript).toContain(
      "programmaticTextEdit && !hasTextCharacters(target)",
    );
  });
});
