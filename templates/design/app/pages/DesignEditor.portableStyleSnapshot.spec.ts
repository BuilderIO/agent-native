/**
 * DesignEditor.portableStyleSnapshot.spec.ts
 *
 * Regression coverage for the cross-screen "portable style snapshot bakes
 * editor-internal CSS custom properties into persisted user HTML" bug: a
 * cross-screen/canvas move used to bake the FULL bridge-captured style dump
 * — including editor chrome variables like --design-editor-accent-color and
 * --agent-native-editor-chrome-scale-x — verbatim onto the moved node's
 * inline style attribute, leaking editor-internal state into exports and
 * freezing dimensions that should reflow.
 *
 * isEditorInternalCssVar is the pure, DOM-independent piece of that fix
 * (applyPortableStyles/applyPortableStyleSnapshotToHtml themselves require a
 * DOMParser/jsdom environment this template's vitest config doesn't provide
 * — see vitest.config.ts, no `environment: "jsdom"` and no jsdom dependency
 * — so this file pins the filtering predicate directly, which is where the
 * actual bug/fix lives).
 */
import { describe, expect, it } from "vitest";

import { isEditorInternalCssVar } from "./DesignEditor";

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
