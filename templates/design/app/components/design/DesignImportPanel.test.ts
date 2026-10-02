import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("DesignImportPanel", () => {
  const source = readFileSync(
    "app/components/design/DesignImportPanel.tsx",
    "utf8",
  );
  const importConstants = readFileSync("app/lib/design-import.ts", "utf8");

  it("imports a Figma frame URL through the shared action surface", () => {
    const urlIndex = source.indexOf('id="figma-url-import"');
    const pasteIndex = source.indexOf('id="figma-paste-import"');

    expect(urlIndex).toBeGreaterThanOrEqual(0);
    expect(urlIndex).toBeLessThan(pasteIndex);
    expect(source).toContain(
      'const importFigmaFrame = useActionMutation("import-figma-frame")',
    );
    expect(source).toContain("parseFigmaFileKey(normalizedUrl)");
    expect(source).toContain("figmaUrl: normalizedUrl");
    expect(source).toContain("designId: context.designId");
    expect(source).toContain("asNewScreen: true");
    expect(source).not.toContain('fetch("/_agent-native/actions/');
  });

  it("checks the saved Figma connection and securely gates URL import", () => {
    expect(source).toContain("getFigmaConnectionStatus()");
    expect(source).toContain("saveFigmaAccessToken(figmaAccessToken)");
    expect(source).toContain('type="password"');
    expect(source).toContain('autoComplete="new-password"');
    expect(source).toContain('setFigmaAccessToken("")');
    expect(source).toContain(
      "A rejected credential should not linger in component state or the DOM.",
    );
    expect(source).toContain(
      "figmaConnectionChecked && !figmaConnected && !figmaConnectionError",
    );
    expect(source).not.toContain("FIGMA_ACCESS_TOKEN:");
  });

  it("copies commands with icon-only buttons", () => {
    expect(source).toContain('aria-label={"Copy command"');
    expect(source).not.toContain('{"Copy"');
    expect(source).not.toContain(">Copy<");
    expect(importConstants).toContain(
      "npx @agent-native/core@latest skills add visual-edit",
    );
    expect(importConstants).toContain(
      "npx @agent-native/core@latest design connect --url 'http://localhost:<port>' --root . --daemon",
    );
    expect(source).toContain(
      "Replace <port> with the running app's local port.",
    );
  });
});

describe("DesignImportPanel quota attribution", () => {
  const source = readFileSync(
    "app/components/design/DesignImportPanel.tsx",
    "utf8",
  );

  it("reads the failure through the shared typed reader", () => {
    expect(source).toContain("readFigmaImportFailure(");
    expect(source).not.toContain("rateLimitDetails.figmaPlanTier");
    expect(source).not.toMatch(/rate limit\|429\|quota/);
  });
});
