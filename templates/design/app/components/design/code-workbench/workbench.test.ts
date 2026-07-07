import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { normalizeMonacoThemeColor } from "../code-workbench-theme";

describe("code workbench shell", () => {
  it("themes from native workbench tokens and suppresses design hotkeys", () => {
    const source = readFileSync(
      "app/components/design/code-workbench/CodeWorkbench.tsx",
      "utf8",
    );
    expect(source).toContain("readCodeWorkbenchTheme");
    expect(source).toContain('data-hotkeys-scope="text"');
    expect(source).toContain("--workbench-bg");
    expect(source).not.toContain("srcDoc=");
    expect(source).not.toContain("#0f1115");
  });

  it("normalizes computed CSS colors before passing them to Monaco", () => {
    expect(normalizeMonacoThemeColor("rgb(230, 230, 230)")).toBe("#e6e6e6");
    expect(normalizeMonacoThemeColor("rgba(14, 165, 233, 0.4)")).toBe(
      "#0ea5e966",
    );
    expect(normalizeMonacoThemeColor("rgb(90% 90% 90% / 50%)")).toBe(
      "#e6e6e680",
    );
    expect(normalizeMonacoThemeColor("#fff")).toBe("#ffffff");
    expect(normalizeMonacoThemeColor("var(--workbench-fg)")).toBeUndefined();
  });

  it("routes saves through the versioned preview→apply source actions", () => {
    const source = readFileSync(
      "app/components/design/code-workbench/workspace/inline-provider.ts",
      "utf8",
    );
    expect(source).toContain('"preview-source-edit"');
    expect(source).toContain('"apply-source-edit"');
    expect(source).toContain("expectedVersionHash");
    expect(source).toContain("WorkspaceStaleVersionError");
  });

  it("places Code directly under Tokens with a rail separator", () => {
    const source = readFileSync("app/pages/DesignEditor.tsx", "utf8");
    const tokensIndex = source.indexOf('panel: "tokens"');
    const codeIndex = source.indexOf('panel: "code"');
    expect(tokensIndex).toBeGreaterThanOrEqual(0);
    expect(codeIndex).toBeGreaterThan(tokensIndex);
    expect(source.slice(tokensIndex, codeIndex + 200)).toContain(
      "separatorBefore: true",
    );
    expect(source).not.toContain("const codeItem =");
  });
});
