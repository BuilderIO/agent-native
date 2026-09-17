// @vitest-environment happy-dom

import { buildCodeLayerProjection } from "@shared/code-layer";
import { afterEach, describe, expect, it } from "vitest";

import { runPublishCanonicalContent } from "@/pages/design-editor/commands/publish-canonical-content";
import type {
  ContentHistoryEntry,
  ContentHistorySelectionAfterMap,
} from "@/pages/design-editor/history";
import { prepareCanonicalSourceContent } from "@/pages/design-editor/source-publication";

import { runOverviewPrimitiveReparent } from "./overview-primitive-reparent";

const SOURCE_ID = "source.html";
const TARGET_ID = "target.html";

function mountPreview(content: string, fileId: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-screen-iframe-id", fileId);
  document.body.append(iframe);
  const preview = iframe.contentDocument!;
  preview.open();
  preview.write(content);
  preview.close();
}

function publishFixture(fileId: string, content: string): string {
  return runPublishCanonicalContent(
    {
      canEditDesignRef: { current: true },
      pendingLocalFileContentsRef: { current: new Map() },
      cancelIdentityMigration: () => {},
      queueFileContentSave: () => {},
    },
    fileId,
    content,
  );
}

function acceptFixture(fileId: string, content: string) {
  const prepared = prepareCanonicalSourceContent(content, {
    fileId,
    fileType: "html",
  });
  return {
    status: "accepted" as const,
    content: prepared.content,
    nodeIdMap: prepared.nodeIdMap,
  };
}

afterEach(() => document.body.replaceChildren());

describe("runOverviewPrimitiveReparent: cross-screen flow semantics", () => {
  it("moves a class-positioned freeform child into CSS-authored flow without offsets", () => {
    const sourceContent = `<html><head><style>
.freeform { display:block; position:relative; }
.positioned { position:absolute; left:31px; top:47px; width:60px; height:40px; }
</style></head><body><section class="freeform"><div data-agent-native-node-id="moving" class="positioned">Move</div></section></body></html>`;
    const targetContent = `<html><head><style>.flow-target { display:flex; gap:12px; }</style></head><body><section data-agent-native-node-id="target" class="flow-target"></section></body></html>`;
    mountPreview(sourceContent, SOURCE_ID);
    mountPreview(targetContent, TARGET_ID);
    const updates = new Map<string, string>();
    const contentById = new Map([
      [SOURCE_ID, sourceContent],
      [TARGET_ID, targetContent],
    ]);
    const contentUndoStackRef = { current: [] as ContentHistoryEntry[] };
    const contentHistorySelectionAfterRef = {
      current: new WeakMap() as ContentHistorySelectionAfterMap,
    };

    runOverviewPrimitiveReparent(
      {
        activeFileId: SOURCE_ID,
        applyFileContentUpdate: (id, content) => {
          const publication = acceptFixture(id, content);
          updates.set(id, publication.content);
          return publication;
        },
        boardFileId: undefined,
        canEditDesign: true,
        contentHistorySelectionAfterRef,
        contentUndoStackRef,
        getScreenContent: (id) => contentById.get(id) ?? "",
        overviewSelectedScreenIds: [SOURCE_ID],
        recordContentHistoryEntry: (entry) =>
          contentUndoStackRef.current.push(entry),
        setSelectedElement: () => {},
        setSelectedLayerIdsState: () => {},
        t: (key) => key,
      },
      {
        sourceNodeId: "moving",
        sourceScreenId: SOURCE_ID,
        targetNodeId: "target",
        targetScreenId: TARGET_ID,
        placement: "inside",
      },
    );

    const nextTarget = updates.get(TARGET_ID);
    expect(nextTarget).toBeTruthy();
    const moved = buildCodeLayerProjection(nextTarget!, {
      source: { kind: "design-file", fileId: TARGET_ID },
    }).nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "moving",
    );
    expect(moved?.parentId).toBeTruthy();
    expect(moved?.style.position).toBe("relative !important");
    expect(moved?.style.left).toBe("auto !important");
    expect(moved?.style.top).toBe("auto !important");
    expect(updates.get(SOURCE_ID)).not.toContain(
      'data-agent-native-node-id="moving"',
    );
    const historyEntry = contentUndoStackRef.current[0]!;
    const selectionAfter =
      contentHistorySelectionAfterRef.current.get(historyEntry);
    expect(selectionAfter).toMatchObject({
      activeFileId: SOURCE_ID,
      overviewSelectedScreenIds: [SOURCE_ID],
      selectedLayerIds: [moved!.id],
    });
    expect(selectionAfter?.sourceContentByFileId).toEqual({
      [TARGET_ID]: nextTarget,
    });
  });

  it("rebases an ignored auto-layout absolute child into a different flow parent", () => {
    const sourceContent = `<html><body><section data-agent-native-node-id="source-parent" style="position:relative;left:20px;top:30px;display:flex"><div data-agent-native-node-id="moving" style="position:absolute;left:24px;top:32px;width:60px;height:40px">Ignored</div></section></body></html>`;
    const targetContent = `<html><head><style>.flow-target { display:flex; }</style></head><body><section data-agent-native-node-id="target" class="flow-target" style="position:relative;left:400px;top:200px"></section></body></html>`;
    mountPreview(sourceContent, SOURCE_ID);
    mountPreview(targetContent, TARGET_ID);
    const updates = new Map<string, string>();
    const contentById = new Map([
      [SOURCE_ID, sourceContent],
      [TARGET_ID, targetContent],
    ]);

    runOverviewPrimitiveReparent(
      {
        applyFileContentUpdate: (id, content) => {
          const publication = acceptFixture(id, content);
          updates.set(id, publication.content);
          return publication;
        },
        boardFileId: undefined,
        canEditDesign: true,
        getScreenContent: (id) => contentById.get(id) ?? "",
        recordContentHistoryEntry: () => {},
        setSelectedElement: () => {},
        setSelectedLayerIdsState: () => {},
        t: (key) => key,
      },
      {
        sourceNodeId: "moving",
        sourceScreenId: SOURCE_ID,
        targetNodeId: "target",
        targetScreenId: TARGET_ID,
        placement: "inside",
      },
    );

    const nextTarget = updates.get(TARGET_ID);
    expect(nextTarget).toBeTruthy();
    const moved = buildCodeLayerProjection(nextTarget!, {
      source: { kind: "design-file", fileId: TARGET_ID },
    }).nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "moving",
    );
    expect(moved?.style.position).toBe("absolute");
    expect(moved?.style.left).toBe("-356px");
    expect(moved?.style.top).toBe("-138px");
  });

  it("rebases an absolute layer when the target is freeform rather than flow", () => {
    const sourceContent = `<html><body><div data-agent-native-node-id="moving" style="position:absolute;left:100px;top:80px;width:40px;height:30px">Move</div></body></html>`;
    const targetContent = `<html><body><section style="position:relative;left:300px;top:200px"><div data-agent-native-node-id="target"></div></section></body></html>`;
    mountPreview(sourceContent, SOURCE_ID);
    mountPreview(targetContent, TARGET_ID);
    const updates = new Map<string, string>();
    const contentById = new Map([
      [SOURCE_ID, sourceContent],
      [TARGET_ID, targetContent],
    ]);

    runOverviewPrimitiveReparent(
      {
        applyFileContentUpdate: (id, content) => {
          const publication = acceptFixture(id, content);
          updates.set(id, publication.content);
          return publication;
        },
        boardFileId: undefined,
        canEditDesign: true,
        getScreenContent: (id) => contentById.get(id) ?? "",
        recordContentHistoryEntry: () => {},
        setSelectedElement: () => {},
        setSelectedLayerIdsState: () => {},
        t: (key) => key,
      },
      {
        sourceNodeId: "moving",
        sourceScreenId: SOURCE_ID,
        targetNodeId: "target",
        targetScreenId: TARGET_ID,
        placement: "inside",
      },
    );

    const nextTarget = updates.get(TARGET_ID);
    expect(nextTarget).toBeTruthy();
    const moved = buildCodeLayerProjection(nextTarget!, {
      source: { kind: "design-file", fileId: TARGET_ID },
    }).nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "moving",
    );
    expect(moved?.style.position).toBe("absolute");
    expect(moved?.style.left).toBe("-200px");
    expect(moved?.style.top).toBe("-120px");
  });

  it("uses the rendered anchor path when identity preparation changes a duplicate ID", () => {
    const rawSourceContent = `<html><head><style>
.freeform { display:block; position:relative; }
.positioned { position:absolute; left:31px; top:47px; width:60px; height:40px; }
</style></head><body><section class="freeform"><div class="positioned" style="position:absolute;left:31px;top:47px">Idless source</div></section></body></html>`;
    const rawTargetContent = `<html><head><style>.flow-target { display:flex; }</style></head><body><section data-agent-native-node-id="duplicate-target" class="flow-target">Chosen anchor</section><section data-agent-native-node-id="duplicate-target" class="other-target" style="display:flex">Other anchor</section></body></html>`;
    const sourceContent = publishFixture(SOURCE_ID, rawSourceContent);
    const targetContent = publishFixture(TARGET_ID, rawTargetContent);
    mountPreview(sourceContent, SOURCE_ID);
    mountPreview(targetContent, TARGET_ID);
    const updates = new Map<string, string>();
    const contentById = new Map([
      [SOURCE_ID, sourceContent],
      [TARGET_ID, targetContent],
    ]);
    const sourceProjection = buildCodeLayerProjection(sourceContent, {
      source: { kind: "design-file", fileId: SOURCE_ID },
    });
    const sourceNode = sourceProjection.nodes.find(
      (node) => node.tag === "div" && node.textSnippet === "Idless source",
    )!;
    const targetProjection = buildCodeLayerProjection(targetContent, {
      source: { kind: "design-file", fileId: TARGET_ID },
    });
    const targetNode = targetProjection.nodes.find(
      (node) => node.tag === "section" && node.textSnippet === "Chosen anchor",
    )!;

    runOverviewPrimitiveReparent(
      {
        applyFileContentUpdate: (id, content) => {
          const publication = acceptFixture(id, content);
          updates.set(id, publication.content);
          return publication;
        },
        boardFileId: undefined,
        canEditDesign: true,
        getScreenContent: (id) => contentById.get(id) ?? "",
        recordContentHistoryEntry: () => {},
        setSelectedElement: () => {},
        setSelectedLayerIdsState: () => {},
        t: (key) => key,
      },
      {
        sourceNodeId: sourceNode.id,
        sourceScreenId: SOURCE_ID,
        targetNodeId: "duplicate-target",
        targetScreenId: TARGET_ID,
        targetIdentity: {
          projection: targetProjection,
          nodeId: targetNode.id,
          authoredNodeId: "duplicate-target",
        },
        placement: "inside",
      },
    );

    const nextSource = updates.get(SOURCE_ID);
    const nextTarget = updates.get(TARGET_ID);
    expect(nextSource).not.toContain("Idless source");
    expect(nextTarget).toContain("Idless source");
    expect(nextTarget).toContain("Other anchor");
    const nextProjection = buildCodeLayerProjection(nextTarget!, {
      source: { kind: "design-file", fileId: TARGET_ID },
    });
    const moved = nextProjection.nodes.find(
      (node) => node.tag === "div" && node.textSnippet === "Idless source",
    );
    const movedParent = nextProjection.nodes.find(
      (node) => node.id === moved?.parentId,
    );
    expect(movedParent?.tag).toBe("section");
    expect(movedParent?.textSnippet).toContain("Chosen anchor");
    expect(moved?.style.position).toBe("relative !important");
    expect(movedParent?.dataAttributes["data-agent-native-node-id"]).toBe(
      targetNode.dataAttributes["data-agent-native-node-id"],
    );
  });
});
