import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSidebarSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("document sidebar layout", () => {
  it("keeps deeply nested page rows reachable in the sidebar", () => {
    const layout = readSidebarSource("../layout/Layout.tsx");
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");
    const treeItem = readSidebarSource("./DocumentTreeItem.tsx");
    const scrollArea = readSidebarSource("../ui/scroll-area.tsx");

    expect(layout).toContain("const MIN_SIDEBAR_WIDTH = 240");
    expect(sidebar).toContain('className="min-w-full w-max py-2 pr-2"');
    expect(treeItem).toContain("const indent = depth * 12 + 12");
    expect(treeItem).toContain("min-w-56");
    expect(scrollArea).toContain('<ScrollBar orientation="horizontal" />');
  });

  it("gates page tree actions by document capabilities", () => {
    const treeItem = readSidebarSource("./DocumentTreeItem.tsx");

    expect(treeItem).toContain("const canEdit = node.canEdit !== false");
    expect(treeItem).toContain("const canManage =");
    expect(treeItem).toContain("{canEdit && (");
    expect(treeItem).toContain("{canManage && (");
  });

  it("keeps active ancestor expansion separate from user-expanded state", () => {
    const sidebar = readSidebarSource("./DocumentSidebar.tsx");

    expect(sidebar).toContain("const activeAncestorIds = useMemo");
    expect(sidebar).toContain(
      "for (const id of activeAncestorIds) expandedIds.add(id)",
    );
    expect(sidebar).toContain("if (activeAncestorIds.has(id)) return");
  });
});
