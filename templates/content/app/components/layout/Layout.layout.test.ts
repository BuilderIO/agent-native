import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readLayoutSource() {
  return readFileSync(new URL("./Layout.tsx", import.meta.url), {
    encoding: "utf8",
  });
}

describe("app layout", () => {
  it("persists the desktop sidebar collapse preference through the shared app shell", () => {
    const source = readLayoutSource();

    expect(source).toContain("usePersistentSidebarCollapsed");
    expect(source).toContain("storageKey: SIDEBAR_COLLAPSED_KEY");
    expect(
      readFileSync(
        new URL("./sidebar-preferences.ts", import.meta.url),
        "utf8",
      ),
    ).toContain('"content.sidebar.collapsed"');
    expect(source).toContain("defaultCollapsed: false");
    expect(source).toContain("collapsed={false}");
    expect(source).toContain(
      "onToggleCollapsed={() => setMobileSidebarOpen(false)}",
    );
  });

  it("includes the current document revision in chat history restores", () => {
    const source = readLayoutSource();

    expect(source).toContain("prepareRegisteredDocumentHistoryRestore");
    expect(source).toContain("applyRegisteredDocumentHistoryRestore");
    expect(source).toContain("expectedUpdatedAt:");
    expect(source).toContain("onRestored: async (restored)");
    expect(source).toContain(
      'toast.error(t("editor.historyRestoreAppliedRefreshFailed"))',
    );
  });
});
