import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("CodeWorkbenchHost theming", () => {
  it("passes native theme tokens into the Monaco workbench", () => {
    const source = readFileSync(
      "app/components/design/CodeWorkbenchHost.tsx",
      "utf8",
    );

    expect(source).toContain("readCodeWorkbenchTheme");
    expect(source).toContain("monaco-editor");
    expect(source).toContain("defineMonacoTheme");
    expect(source).toContain("--workbench-bg");
    expect(source).toContain("theme,");
    expect(source).not.toContain("<textarea");
    expect(source).not.toContain("srcDoc=");
    expect(source).not.toContain("#0f1115");
    expect(source).not.toContain("#0b0d12");
    expect(source).not.toContain("bg-[#0b0d12]");
  });

  it("keeps workbench file selection, preview, and draft base versions independent", () => {
    const source = readFileSync(
      "app/components/design/CodeWorkbenchHost.tsx",
      "utf8",
    );

    expect(source).toContain("lastExternalTargetKeyRef");
    expect(source).toContain('useActionMutation("preview-source-edit")');
    expect(source).toContain("baseVersionHash");
    expect(source).toContain("activeDraft?.baseVersionHash");
    expect(source).not.toContain(
      "[activeFileId, activeFilename, activePath, sourceFiles]",
    );
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
