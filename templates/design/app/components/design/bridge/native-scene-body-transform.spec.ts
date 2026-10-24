// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachNativeScenePresentationCanvas,
  supportsNativeSceneBodyTransform,
} from "./native-scene-body-transform";

const style = (overrides: Record<string, string> = {}) =>
  ({
    opacity: "1",
    transform: "none",
    translate: "none",
    rotate: "none",
    scale: "none",
    perspective: "none",
    transformStyle: "flat",
    zIndex: "auto",
    ...overrides,
  }) as CSSStyleDeclaration;

afterEach(() => {
  document.documentElement
    .querySelectorAll("canvas[data-an-native-scene-presentation]")
    .forEach((canvas) => canvas.remove());
});

describe("native scene body projection", () => {
  it("accepts positive axis-aligned scale and translation but rejects rotation, mirroring, 3D and opacity", () => {
    expect(supportsNativeSceneBodyTransform(style())).toBe(true);
    expect(
      supportsNativeSceneBodyTransform(
        style({ transform: "matrix(0.5, 0, 0, 0.5, 12, -8)" }),
      ),
    ).toBe(true);
    expect(
      supportsNativeSceneBodyTransform(
        style({ transform: "matrix(0.5, 0.1, 0, 0.5, 0, 0)" }),
      ),
    ).toBe(false);
    expect(
      supportsNativeSceneBodyTransform(
        style({ transform: "matrix(-1, 0, 0, 1, 0, 0)" }),
      ),
    ).toBe(false);
    expect(
      supportsNativeSceneBodyTransform(style({ perspective: "400px" })),
    ).toBe(false);
    expect(supportsNativeSceneBodyTransform(style({ opacity: "0.5" }))).toBe(
      false,
    );
    expect(
      supportsNativeSceneBodyTransform(
        style({ transform: "matrix(0.5, 0, 0, 0.5, 0, 0)", zIndex: "1" }),
      ),
    ).toBe(false);
  });

  it("reports unreadable computed transforms as a typed source error", () => {
    const matrix = DOMMatrixReadOnly;
    vi.stubGlobal(
      "DOMMatrixReadOnly",
      class {
        constructor() {
          throw new SyntaxError("Malformed matrix");
        }
      },
    );
    try {
      expect(() =>
        supportsNativeSceneBodyTransform(
          style({ transform: "matrix(broken)" }),
        ),
      ).toThrow("The body transform cannot be read.");
    } finally {
      vi.stubGlobal("DOMMatrixReadOnly", matrix);
    }
  });

  it("keeps ordinary scenes inside body and moves transformed scenes above body but below root chrome", () => {
    const canvas = document.createElement("canvas");
    canvas.setAttribute("data-an-native-scene-presentation", "");
    const chrome = document.createElement("div");
    chrome.setAttribute("data-agent-native-editor-chrome-host", "");
    document.documentElement.append(chrome);
    try {
      attachNativeScenePresentationCanvas(canvas, document.body, style());
      expect(document.body.firstChild).toBe(canvas);
      const scaled = style({ transform: "matrix(0.5, 0, 0, 0.5, 0, 0)" });
      attachNativeScenePresentationCanvas(canvas, document.body, scaled);
      expect(canvas.parentElement).toBe(document.documentElement);
      expect(canvas.previousElementSibling).toBe(document.body);
      expect(canvas.nextElementSibling).toBe(chrome);
      attachNativeScenePresentationCanvas(canvas, document.body, scaled);
      expect(canvas.previousElementSibling).toBe(document.body);
      attachNativeScenePresentationCanvas(canvas, document.body, style());
      expect(document.body.firstChild).toBe(canvas);
    } finally {
      chrome.remove();
    }
  });
});
