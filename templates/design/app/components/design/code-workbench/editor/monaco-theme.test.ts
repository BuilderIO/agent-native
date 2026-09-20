import { describe, expect, it } from "vitest";

import { buildThemeColors, buildThemeRules } from "./monaco-theme-palette";

describe("buildThemeRules", () => {
  it("produces hex foregrounds (no #) for every curated scope", () => {
    const rules = buildThemeRules("light");
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.foreground).toMatch(/^[0-9a-f]{6}$/i);
    }
  });

  it("marks comments italic", () => {
    const rules = buildThemeRules("light");
    const comment = rules.find((rule) => rule.token === "comment");
    expect(comment?.fontStyle).toBe("italic");
  });

  it("produces different foregrounds for light vs dark", () => {
    const light = buildThemeRules("light");
    const dark = buildThemeRules("dark");
    const lightKeyword = light.find((rule) => rule.token === "keyword");
    const darkKeyword = dark.find((rule) => rule.token === "keyword");
    expect(lightKeyword?.foreground).not.toBe(darkKeyword?.foreground);
  });

  it("covers tag, string, function, and type scopes", () => {
    const tokens = buildThemeRules("dark").map((rule) => rule.token);
    expect(tokens).toContain("tag");
    expect(tokens).toContain("string");
    expect(tokens).toContain("entity.name.function");
    expect(tokens).toContain("entity.name.type");
  });
});

describe("buildThemeColors", () => {
  it("maps workbench vars to Monaco color keys, normalized to hex", () => {
    // buildThemeColors receives already browser-resolved CSS color values
    // (readCodeWorkbenchTheme runs them through resolveCssColorValue, which
    // turns hsl()/named colors into rgb() before they reach here) — hex and
    // rgb() are the two shapes normalizeMonacoThemeColor understands.
    const colors = buildThemeColors({
      "--workbench-editor-bg": "rgb(255, 255, 255)",
      "--workbench-fg": "#111111",
      "--workbench-accent": "rgb(96, 165, 250)",
    });
    expect(colors["editor.background"]).toBe("#ffffff");
    expect(colors["editor.foreground"]).toBe("#111111");
    expect(colors["editorCursor.foreground"]).toBeDefined();
    expect(colors.focusBorder).toBeDefined();
  });

  it("omits keys for missing or unresolvable values", () => {
    const colors = buildThemeColors({});
    expect(colors["editor.background"]).toBeUndefined();
    expect(Object.keys(colors)).toHaveLength(0);
  });

  it("maps error/warning markers from workbench status vars", () => {
    const colors = buildThemeColors({
      "--workbench-error": "rgb(220, 38, 38)",
      "--workbench-warning": "rgb(217, 119, 6)",
    });
    expect(colors["editorError.foreground"]).toBeDefined();
    expect(colors["editorWarning.foreground"]).toBeDefined();
  });

  it("maps list, input, and suggest widget colors", () => {
    const colors = buildThemeColors({
      "--workbench-list-hover-bg": "#eeeeee",
      "--workbench-list-active-bg": "#dddddd",
      "--workbench-input-bg": "#ffffff",
      "--workbench-input-border": "#cccccc",
      "--workbench-surface-bg": "#f5f5f5",
    });
    expect(colors["list.hoverBackground"]).toBe("#eeeeee");
    expect(colors["list.activeSelectionBackground"]).toBe("#dddddd");
    expect(colors["input.background"]).toBe("#ffffff");
    expect(colors["input.border"]).toBe("#cccccc");
    expect(colors["editorSuggestWidget.background"]).toBe("#f5f5f5");
  });
});
