import { describe, expect, it } from "vitest";

import { sanitizeSlotContextForPostMessage } from "./EmbeddedExtension.js";

/**
 * Regression test for a DataCloneError bug: EmbeddedExtension's onLoad
 * handler and its "context changed" effect both posted the raw slot
 * `context` object straight into `window.postMessage`. Real slot contexts
 * (e.g. Design's DesignExtensionSlotContext) carry live callback functions
 * the host uses internally (onShaderFillPreview, onShaderFillApplied, ...).
 * `postMessage` uses the structured clone algorithm, which throws
 * `DataCloneError: ... could not be cloned` on any function-valued
 * property — so every extension iframe load logged a console error and
 * never actually received the context update. The fix round-trips the
 * context through JSON (matching the `contextJson` string already computed
 * for the effect's dependency array) before posting it.
 */
describe("sanitizeSlotContextForPostMessage", () => {
  it("drops function-valued properties", () => {
    const sanitized = sanitizeSlotContextForPostMessage({
      designId: "abc123",
      onShaderFillPreview: (_descriptor: unknown, _css: string) => {},
      onShaderFillPreviewClear: () => {},
    });
    expect(sanitized).toEqual({ designId: "abc123" });
    expect("onShaderFillPreview" in sanitized).toBe(false);
  });

  it("preserves plain nested data untouched", () => {
    const sanitized = sanitizeSlotContextForPostMessage({
      designId: "abc123",
      screens: [{ id: "f1", filename: "index.html" }],
      selectedElement: { selector: "#hero", nodeId: "n1" },
      zoom: 1.5,
    });
    expect(sanitized).toEqual({
      designId: "abc123",
      screens: [{ id: "f1", filename: "index.html" }],
      selectedElement: { selector: "#hero", nodeId: "n1" },
      zoom: 1.5,
    });
  });

  it("returns an empty object for null/undefined context", () => {
    expect(sanitizeSlotContextForPostMessage(null)).toEqual({});
    expect(sanitizeSlotContextForPostMessage(undefined)).toEqual({});
  });

  it("fails safe to an empty object on a circular reference", () => {
    const circular: Record<string, unknown> = { designId: "abc123" };
    circular.self = circular;
    expect(sanitizeSlotContextForPostMessage(circular)).toEqual({});
  });
});
