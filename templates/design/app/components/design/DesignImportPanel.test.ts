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

  it("shows one result toast and leaves generic .fig caveats to the upload UI", () => {
    expect(source).toContain("importResultNotification(result, fallback)");
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
