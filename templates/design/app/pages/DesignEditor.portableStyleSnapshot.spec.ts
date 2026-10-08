import { describe, expect, it } from "vitest";

import { isEditorInternalCssVar } from "./design-editor/portable-style";

describe("isEditorInternalCssVar", () => {
  it("flags every known --design-editor-* chrome variable", () => {
    expect(isEditorInternalCssVar("--design-editor-accent-color")).toBe(true);
    expect(isEditorInternalCssVar("--design-editor-selection-color")).toBe(
      true,
    );
    expect(isEditorInternalCssVar("--design-editor-panel-bg")).toBe(true);
  });

  it("flags --agent-native-editor-chrome-* scale/line-scale compensation variables", () => {
    expect(isEditorInternalCssVar("--agent-native-editor-chrome-scale-x")).toBe(
      true,
    );
    expect(isEditorInternalCssVar("--agent-native-editor-chrome-scale-y")).toBe(
      true,
    );
    expect(
      isEditorInternalCssVar("--agent-native-editor-chrome-line-scale"),
    ).toBe(true);
  });

  it("flags other --agent-native-* framework/editor plumbing variables", () => {
    expect(isEditorInternalCssVar("--agent-native-clipboard-v1")).toBe(true);
    expect(isEditorInternalCssVar("--agent-native-lower-surface")).toBe(true);
    expect(isEditorInternalCssVar("--agent-native-raised-border")).toBe(true);
  });

  it("does NOT flag design-system tokens or ordinary custom properties", () => {
    expect(isEditorInternalCssVar("--accent")).toBe(false);
    expect(isEditorInternalCssVar("--paper")).toBe(false);
    expect(isEditorInternalCssVar("--ink")).toBe(false);
    expect(isEditorInternalCssVar("--tw-translate-x")).toBe(false);
    expect(isEditorInternalCssVar("--brand-primary-500")).toBe(false);
  });

  it("does not flag non-custom-property style names", () => {
    expect(isEditorInternalCssVar("width")).toBe(false);
    expect(isEditorInternalCssVar("transform-origin")).toBe(false);
    expect(isEditorInternalCssVar("place-content")).toBe(false);
  });
});
