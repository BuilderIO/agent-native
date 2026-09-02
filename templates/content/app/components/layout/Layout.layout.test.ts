import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readLayoutSource() {
  return readFileSync(new URL("./Layout.tsx", import.meta.url), {
    encoding: "utf8",
  });
}

describe("app layout", () => {
  it("exposes the sidebar width to editor content for responsive surfaces", () => {
    const source = readLayoutSource();

    expect(source).toContain("const contentSidebarWidth = isMobile");
    expect(source).toContain('"--content-sidebar-width"');
    expect(source).toContain("sidebarCollapsed");
  });

  it("persists the desktop sidebar collapse preference through the shared app shell", () => {
    const source = readLayoutSource();

    expect(source).toContain("usePersistentSidebarCollapsed");
    expect(source).toContain("storageKey: SIDEBAR_COLLAPSED_KEY");
    expect(source).toContain('"content.sidebar.collapsed"');
    expect(source).toContain("defaultCollapsed: false");
    expect(source).toContain("collapsed={false}");
    expect(source).toContain(
      "onToggleCollapsed={() => setMobileSidebarOpen(false)}",
    );
  });

  it("uses pending document navigation for immediate sidebar and editor feedback", () => {
    const source = readLayoutSource();

    expect(source).toContain("useNavigation()");
    expect(source).toContain("documentPageIdFromPathname(location.pathname)");
    expect(source).toContain("documentPageIdFromPathname(pendingPathname)");
    expect(source).toContain(
      "const activeDocumentId = pendingDocumentId ?? currentDocumentId",
    );
    expect(source).toContain("const showPendingDocumentSkeleton =");
    expect(source).toContain("<DocumentEditorSkeleton />");
  });

  it("creates keyboard pages without waiting for persistence before returning", () => {
    const source = readLayoutSource();

    expect(source).toContain("useCreatePage({ awaitPersist: false })");
  });
});
