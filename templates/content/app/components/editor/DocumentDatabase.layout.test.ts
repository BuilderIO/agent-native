import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readDatabaseSource() {
  return [
    "./database/DatabaseView.tsx",
    "./database/DatabaseViewSkeleton.tsx",
    "./database/ContentTable.tsx",
    "./database/settings.tsx",
    "./database/shared.tsx",
    "./database/view-config.ts",
    "./database/view-state.ts",
  ]
    .map((path) =>
      readFileSync(new URL(path, import.meta.url), {
        encoding: "utf8",
      }),
    )
    .join("\n");
}

describe("document database layout", () => {
  it("keeps preview property popovers inside the side preview sheet", () => {
    expect(
      readFileSync(new URL("./DocumentEditor.tsx", import.meta.url), "utf8"),
    ).toContain("popoversPortalled={false}");
  });

  it("keeps idle reloads, source-panel mounts, remounts, and focus local until explicit refresh", () => {
    const source = readDatabaseSource();

    expect(source).not.toContain("const autoSyncEnabled");
    expect(source).not.toContain('window.addEventListener("focus"');
    expect(source).not.toContain("refreshSourceRef.current()");
    expect(source.match(/dbText\("refreshSource"\)/g)).toHaveLength(2);
    expect(
      source.match(/onClick=\{\(\) => onRefreshSource\(source\.id\)\}/g),
    ).toHaveLength(2);
    expect(source).toContain(
      'builderSourceRowFetchStatus(source) === "fetching"',
    );
    expect(source).toContain("source.metadata.lastReadHasMore === true");
    expect(source).toContain("const continuationKey");
  });

  it("does not publish an export context before database data is available", () => {
    const source = readDatabaseSource();

    expect(source).toContain("useMemo<DatabaseExportContext | null>");
    expect(source).toContain("data\n        ? {");
    expect(source).toContain("onExportContextChange?.(exportContext)");

    const editorSource = readFileSync(
      new URL("./DocumentEditor.tsx", import.meta.url),
      { encoding: "utf8" },
    );
    expect(editorSource).toContain("databaseExportContextFingerprintRef");
    expect(editorSource).toContain(
      "onExportContextChange={handleDatabaseExportContextChange}",
    );
  });

  it("keeps selection controls visible and hides mutations without permission", () => {
    const source = readDatabaseSource();
    const selectionBarIndex = source.indexOf("<DatabaseSelectionBar");
    const scrollSurfaceIndex = source.indexOf(
      "<ContentTableSurface",
      selectionBarIndex,
    );

    expect(selectionBarIndex).toBeGreaterThan(-1);
    expect(scrollSurfaceIndex).toBeGreaterThan(selectionBarIndex);
    expect(source).toContain("document.canEdit === true");
    expect(source).toContain("effectiveCanEdit && document.canManage === true");
    expect(source).toContain("canRemoveSelected={canRemoveSelected}");
    expect(source).toContain("Clear");
  });
});
