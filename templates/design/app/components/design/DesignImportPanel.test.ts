import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("DesignImportPanel", () => {
  const source = readFileSync(
    "app/components/design/DesignImportPanel.tsx",
    "utf8",
  );
  const editorSource = readFileSync("app/pages/DesignEditor.tsx", "utf8");
  const importConstants = readFileSync("app/lib/design-import.ts", "utf8");

  it("keeps Local app in the main import source list", () => {
    const htmlIndex = source.indexOf('id="html-import"');
    const localIndex = source.indexOf('id="local-app-import"');
    const moreSourcesIndex = source.indexOf('"More sources"');

    expect(htmlIndex).toBeGreaterThanOrEqual(0);
    expect(localIndex).toBeGreaterThan(htmlIndex);
    expect(localIndex).toBeLessThan(moreSourcesIndex);
  });

  it("uses canvas paste guidance and offers an experimental .fig upload", () => {
    expect(source).toContain(
      "Copy a frame in Figma, then paste into the canvas.",
    );
    expect(source).toContain(
      "Click the canvas first, then paste with the same shortcut you use for copied Design content.",
    );
    expect(source).not.toContain("paste here");
    expect(source).not.toContain("Paste Figma content here");
    expect(source).toContain('id="fig-file-import"');
    expect(source).toContain('accept=".fig,application/octet-stream"');
    expect(source).toContain("uploadDesignFile({");
    expect(source).toContain("validateFigUploadFile(file)");
    expect(source).toContain('role="progressbar"');
    expect(source).toContain("figUploadProgress === 100");
  });

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

  it("shows one result toast and leaves generic .fig caveats to the upload UI", () => {
    expect(source).toContain("importResultNotification(result, fallback, {");
    expect(source).toContain("figmaImageFallbackWarning");
    expect(source).toContain("figmaApproximationWarning");
    expect(source).toContain("formatNumber(imageFallbackCount)");
    expect(source).toContain('notification.variant === "warning"');
    expect(source).not.toContain(
      'toast.warning(t("designEditor.import.warningsToast")',
    );
  });

  it("supports canvas-level Figma paste through the editor paste handler", () => {
    expect(editorSource).toContain("const handleEditorPaste");
    expect(editorSource).toContain(
      "getFigmaClipboardContent(event.clipboardData)",
    );
    expect(editorSource).toContain(
      "void importFigmaClipboardIntoDesign(figmaContent)",
    );
    expect(editorSource).toContain(
      'document.addEventListener("paste", handleEditorPaste, true)',
    );
  });

  it("shows visual-edit setup without the broken agent button", () => {
    expect(source).toContain("VISUAL_EDIT_INSTALL_COMMAND");
    expect(source).toContain("VISUAL_EDIT_CONNECT_COMMAND");
    expect(source).toContain('href="/docs/template-design"');
    expect(source).not.toContain("sendToDesignAgentChat");
    expect(source).not.toContain("useVisualEditNow");
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
