import { describe, expect, it } from "vitest";

import { sanitizeSlotContextForPostMessage } from "./EmbeddedExtension.js";

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
