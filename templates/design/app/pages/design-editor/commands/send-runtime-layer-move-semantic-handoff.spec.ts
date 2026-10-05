import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendToDesignAgentChat } from "@/lib/agent-chat";

import { runSendRuntimeLayerMoveSemanticHandoff } from "./send-runtime-layer-move-semantic-handoff";

vi.mock("@/lib/agent-chat", () => ({
  sendToDesignAgentChat: vi.fn(),
}));

describe("runSendRuntimeLayerMoveSemanticHandoff", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves the selected grid cell in the coding-agent handoff", () => {
    const sourceProjection = buildCodeLayerProjection(
      `<div data-agent-native-node-id="subject" data-source-file="/workspace/src/Screen.tsx" data-source-line="7" data-source-column="3" data-source-framework="react"></div>`,
    );
    const targetProjection = buildCodeLayerProjection(
      `<main data-agent-native-node-id="grid" data-source-file="/workspace/src/Screen.tsx" data-source-line="12" data-source-column="1" data-source-framework="react"></main>`,
    );
    const sourceNode = sourceProjection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "subject",
    )!;
    const targetNode = targetProjection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "grid",
    )!;
    const owners = new Map([
      [
        sourceNode.id,
        {
          fileId: "source",
          node: sourceNode,
          tree: buildCodeLayerTree(sourceProjection),
          runtimeOnly: true,
        },
      ],
      [
        targetNode.id,
        {
          fileId: "target",
          node: targetNode,
          tree: buildCodeLayerTree(targetProjection),
          runtimeOnly: false,
        },
      ],
    ]);

    expect(
      runSendRuntimeLayerMoveSemanticHandoff(
        {
          codeLayerOwnerByNodeIdRef: { current: owners },
          localhostConnectionRootPathByIdRef: {
            current: new Map([
              ["source-connection", "/workspace"],
              ["target-connection", "/workspace"],
            ]),
          },
          overviewScreens: [
            {
              id: "source",
              filename: "source.tsx",
              content: "",
              updatedAt: "2026-10-02T00:00:00.000Z",
              heightPinned: false,
              connectionId: "source-connection",
            },
            {
              id: "target",
              filename: "target.tsx",
              content: "",
              updatedAt: "2026-10-02T00:00:00.000Z",
              heightPinned: false,
              connectionId: "target-connection",
            },
          ],
          runtimeLayerSnapshotsById: {},
          setActiveLeftPanel: vi.fn(),
          t: (key) => key,
        },
        sourceNode.id,
        targetNode.id,
        "inside",
        { column: 3, columnEnd: 4, row: 2, rowEnd: 3 },
      ),
    ).toBe(true);

    const request = vi.mocked(sendToDesignAgentChat).mock.calls[0]?.[0];
    expect(request).toBeDefined();
    const context = request?.context ?? "";
    expect(context).toContain('"gridPlacement"');
    expect(context).toContain("grid column 3 and row 2");
  });
});
