import { describe, expect, it } from "vitest";

import {
  formatPendingVisualStylePrompt,
  pendingStructureEditSourcePaths,
  projectRelativeSourcePath,
  type PendingLiveStructureEdit,
} from "./pending-edits";

function liveDrawEdit(
  overrides: Partial<PendingLiveStructureEdit> = {},
): PendingLiveStructureEdit {
  return {
    kind: "structure",
    screenId: "screen-home",
    filename: "home",
    screenName: "Home",
    selector: '[data-agent-native-node-id="rect-1"]',
    sourceId: "rect-1",
    anchorSelector: "body",
    anchorSourceId: null,
    placement: "inside",
    dropMode: "flow-insert",
    insertedHtml:
      '<div data-agent-native-node-id="rect-1" style="position:absolute;left:10px;top:20px;width:100px;height:50px"></div>',
    routeSourceFile: "src/App.tsx",
    requestId: "move-1",
    updatedAt: 1,
    ...overrides,
  };
}

describe("live screen canvas primitive source targeting", () => {
  it("uses the manifest route source when a body insert has no element provenance", () => {
    expect(pendingStructureEditSourcePaths(liveDrawEdit())).toEqual([
      "src/App.tsx",
    ]);
  });

  it("keeps an insert without manifest source provenance unresolved", () => {
    const edit = liveDrawEdit({ routeSourceFile: undefined });
    expect(pendingStructureEditSourcePaths(edit)).toBeNull();

    const prompt = formatPendingVisualStylePrompt({
      designId: "design-1",
      edits: [],
      liveEdits: [edit],
    });
    expect(prompt).toContain('"insertedHtml"');
    expect(prompt).toContain('"code": "missing-source-provenance"');
    expect(prompt).not.toContain('"routeSourceFile"');
  });

  it("prefers exact element provenance when the bridge provides it", () => {
    expect(
      pendingStructureEditSourcePaths(
        liveDrawEdit({
          anchorSourceAnchor: {
            id: "target",
            sourceFile: "/workspace/src/Layout.tsx",
            relPath: "src/Layout.tsx",
            line: 10,
            column: 3,
            runtimeMultiplicity: 1,
            scope: "unknown",
          },
        }),
      ),
    ).toEqual(["src/Layout.tsx"]);
  });

  it("keeps the Apply prompt bounded to the route file without inventing a body source line", () => {
    const prompt = formatPendingVisualStylePrompt({
      designId: "design-1",
      edits: [],
      liveEdits: [liveDrawEdit()],
    });

    expect(prompt).toContain('"routeSourceFile": "src/App.tsx"');
    expect(prompt).toContain(
      "Treat `routeSourceFile` as the bounded source target",
    );
    expect(prompt).toContain('"insertedHtml"');
    expect(prompt).not.toContain('"line": 1');
  });
});

describe("projectRelativeSourcePath", () => {
  it("accepts manifest-relative files and relativizes absolute files inside the connection root", () => {
    expect(projectRelativeSourcePath({ sourceFile: "src/App.tsx" })).toBe(
      "src/App.tsx",
    );
    expect(
      projectRelativeSourcePath({ sourceFile: "public/checkout.html" }),
    ).toBe("public/checkout.html");
    expect(
      projectRelativeSourcePath({
        sourceFile: "/workspace/app/src/App.tsx",
        rootPath: "/workspace/app",
      }),
    ).toBe("src/App.tsx");
  });

  it("rejects files outside the connection root and relative traversal", () => {
    expect(
      projectRelativeSourcePath({
        sourceFile: "/workspace/other/App.tsx",
        rootPath: "/workspace/app",
      }),
    ).toBeUndefined();
    expect(
      projectRelativeSourcePath({ sourceFile: "../private/App.tsx" }),
    ).toBeUndefined();
    expect(
      projectRelativeSourcePath({ sourceFile: "/checkout" }),
    ).toBeUndefined();
    expect(projectRelativeSourcePath({})).toBeUndefined();
  });
});
