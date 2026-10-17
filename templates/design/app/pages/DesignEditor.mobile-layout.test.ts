import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readDesignEditorSource } from "./design-editor/read-design-editor-source";

describe("Design editor mobile layout", () => {
  const editorSource = readDesignEditorSource();
  const layoutSource = readFileSync("app/components/layout/Layout.tsx", "utf8");

  it("keeps the app shell in non-Builder embedded routes", () => {
    expect(layoutSource).toContain(
      'type DesignLayoutMode = "host-bare" | "standalone-editor" | "app-shell";',
    );
    expect(layoutSource).toContain('if (layoutMode === "host-bare")');
    expect(layoutSource).toContain('if (layoutMode === "standalone-editor")');
    expect(layoutSource).toContain(
      "!embedded && EDITOR_PREFIXES.some((p) => location.pathname.startsWith(p))",
    );
    expect(layoutSource).toContain("input.embedChromeRequested");
    expect(layoutSource).toContain(
      "const showAppNav = !standaloneEditor && !isSettingsRoute;",
    );
    expect(layoutSource).toContain("{showAppNav && (\n");
  });

  it("keeps save warnings out of a read-only directory widget but not other sessions", () => {
    const warn = editorSource.slice(
      editorSource.indexOf("const warnChangesWillRetry = useCallback"),
      editorSource.indexOf("const journalOutboxEntry = useCallback"),
    );

    expect(warn).toContain(
      'if (readOnlyWidget) return;\n    toast.warning(t("visualEditor.changesSaveWhenReconnected")',
    );
    expect(warn).toContain(
      'if (readOnlyWidget) return;\n    toast.error(t("visualEditor.changesDiscarded")',
    );
    expect(warn).toContain(
      'if (readOnlyWidget) return;\n          toast.error(t("designEditor.toasts.saveConflict")',
    );
    expect(warn).toContain(
      'if (readOnlyWidget) return;\n          toast.error(message ?? t("common.genericError")',
    );
    // Every toast stays otherwise unconditional, so normal sessions still warn.
    expect(warn.match(/if \(readOnlyWidget\) return;/g)).toHaveLength(4);
  });
});
