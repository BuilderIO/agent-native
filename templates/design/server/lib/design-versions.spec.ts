// oracle-change(e2e/beta/specs/apps/journey-design-systems-indexing.spec.ts): Design Systems removed from Design with its feature code
// oracle-change(templates/design/actions/create-design-system.spec.ts): Design Systems removed from Design with its feature code
// oracle-change(templates/design/actions/delete-design-system.spec.ts): Design Systems removed from Design with its feature code
// oracle-change(templates/design/actions/get-design-system-index-status.spec.ts): Design Systems removed from Design with its feature code
// oracle-change(templates/design/actions/get-design-system.spec.ts): Design Systems removed from Design with its feature code
// oracle-change(templates/design/actions/index-design-system-with-builder.test.ts): Design Systems removed from Design with its feature code
// oracle-change(templates/design/actions/list-design-systems.test.ts): Design Systems removed from Design with its feature code
// oracle-change(templates/design/actions/refresh-design-system-with-builder.spec.ts): Design Systems removed from Design with its feature code
// oracle-change(templates/design/actions/set-default-design-system.spec.ts): Design Systems removed from Design with its feature code
// oracle-change(templates/design/actions/sync-design-system-with-builder.spec.ts): Design Systems removed from Design with its feature code
// oracle-change(templates/design/app/components/design-system/JoinDesignSystemWaitlistButton.test.tsx): Design Systems removed from Design with its feature code
// oracle-change(templates/design/app/lib/design-system-data.spec.ts): Design Systems removed from Design with its feature code
// oracle-change(templates/design/app/lib/design-system-preview.test.ts): Design Systems removed from Design with its feature code
// oracle-change(templates/design/app/lib/design-system-waitlist.test.ts): Design Systems removed from Design with its feature code
// oracle-change(templates/design/app/pages/DesignSystems.pointer-lock.test.ts): Design Systems removed from Design with its feature code
// oracle-change(templates/design/app/pages/DesignSystems.refresh.test.ts): Design Systems removed from Design with its feature code
// oracle-change(templates/design/app/pages/design-system-tier-limit.test.tsx): Design Systems removed from Design with its feature code
// oracle-change(templates/design/e2e/create-without-design-system.spec.ts): Design Systems removed from Design with its feature code
// oracle-change(templates/design/e2e/design-system-design-md-import.spec.ts): Design Systems removed from Design with its feature code
// oracle-change(templates/design/e2e/design-system-github-import.spec.ts): Design Systems removed from Design with its feature code
// oracle-change(templates/design/e2e/home-system-selection.spec.ts): Design Systems removed from Design with its feature code
// oracle-change(templates/design/server/handlers/design-system-workflows.spec.ts): Design Systems removed from Design with its feature code
// oracle-change(templates/design/server/lib/builder-design-system-proxy.spec.ts): Design Systems removed from Design with its feature code
// oracle-change(templates/design/shared/design-system-templates.test.ts): Design Systems removed from Design with its feature code
// oracle-change(templates/design/actions/clone-creative-context-design-native.spec.ts): Creative context removed from Design with its feature code
// oracle-change(templates/design/actions/clone-creative-context-design.spec.ts): Creative context removed from Design with its feature code
// oracle-change(templates/design/app/pages/design-editor/creative-context-precedent.test.ts): Creative context removed from Design with its feature code
// oracle-change(templates/design/app/pages/design-editor/intake-question-topics.test.ts): Creative context removed from Design with its feature code
// oracle-change(templates/design/server/lib/generation-reuse-labels.spec.ts): Creative context removed from Design with its feature code
// oracle-change: checkpoints are captured with SQL against the real database now; capture, dedupe, throttle and retention are covered in design-versions.manifest.pglite.spec.ts, and blob uploads and skipped checkpoints no longer exist
import { describe, expect, it, vi } from "vitest";

const readPrivateBlob = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/private-blob", () => ({
  deletePrivateBlob: vi.fn(),
  readPrivateBlob,
}));

import {
  parseDesignVersionSnapshot,
  readDesignVersionSnapshot,
} from "./design-versions.js";

describe("parseDesignVersionSnapshot", () => {
  it("accepts buildDesignSnapshot files and preserves restore metadata", () => {
    const snapshot = parseDesignVersionSnapshot(
      JSON.stringify({
        designId: "design-1",
        designData: JSON.stringify({ breakpointSet: { breakpoints: [] } }),
        designTitle: "Landing page",
        designDescription: null,
        projectType: "prototype",
        tweaks: [{ id: "color", cssVar: "--color" }],
        appliedTweaks: { color: "blue" },
        resolvedCssVars: { "--color": "blue" },
        deletionGeometry: {
          fileId: "file-1",
          mainNodeId: "main-1",
          sourceVersionHash: "hash-1",
          boundingRect: { x: 10, y: 20, width: 100, height: 70 },
        },
        files: [
          {
            id: "file-1",
            filename: "src/index.html",
            fileType: "html",
            content: "<main>Hello</main>",
            source: "collab",
          },
        ],
        chatContext: { threadId: "thread-1", turnId: "turn-1" },
      }),
      "design-1",
    );

    expect(snapshot).toMatchObject({
      designId: "design-1",
      designTitle: "Landing page",
      tweaks: [{ id: "color", cssVar: "--color" }],
      appliedTweaks: { color: "blue" },
      resolvedCssVars: { "--color": "blue" },
      deletionGeometry: {
        fileId: "file-1",
        mainNodeId: "main-1",
        sourceVersionHash: "hash-1",
        boundingRect: { x: 10, y: 20, width: 100, height: 70 },
      },
      chatContext: { threadId: "thread-1", turnId: "turn-1" },
    });
    expect(snapshot.files).toEqual([
      {
        id: "file-1",
        filename: "src/index.html",
        fileType: "html",
        content: "<main>Hello</main>",
      },
    ]);
  });

  it("rejects snapshots that can cross a design or map two files to one name", () => {
    expect(() =>
      parseDesignVersionSnapshot(
        JSON.stringify({
          designId: "other-design",
          files: [],
        }),
        "design-1",
      ),
    ).toThrow("different design");

    expect(() =>
      parseDesignVersionSnapshot(
        JSON.stringify({
          designId: "design-1",
          files: [
            { filename: "index.html", fileType: "html", content: "one" },
            { filename: "index.html", fileType: "html", content: "two" },
          ],
        }),
        "design-1",
      ),
    ).toThrow("duplicate file");
  });

  it("reads large snapshots through their private blob reference", async () => {
    const handle = {
      id: "blob-1",
      provider: "test",
      opaque: true as const,
      encrypted: true,
    };
    readPrivateBlob.mockResolvedValue({
      data: Buffer.from(
        JSON.stringify({
          designId: "design-1",
          files: [
            {
              filename: "index.html",
              fileType: "html",
              content: "<main>Restored</main>",
            },
          ],
        }),
      ),
      handle,
    });

    await expect(
      readDesignVersionSnapshot(
        JSON.stringify({
          snapshotKind: "design-history-blob",
          designId: "design-1",
          blob: handle,
        }),
        "design-1",
      ),
    ).resolves.toMatchObject({
      designId: "design-1",
      files: [{ content: "<main>Restored</main>" }],
    });
    expect(readPrivateBlob).toHaveBeenCalledWith(handle);
  });
});
