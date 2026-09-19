import { describe, expect, it } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import {
  runRecordPendingLiveStructureEdit,
  type RecordPendingLiveStructureEditArgs,
} from "./commands/record-pending-live-structure-edit";
import { formatPendingVisualStylePrompt } from "./pending-edits";

const SCREEN_ID = "url-variant-screen";
const SOURCE_FILE = "/project/src/routes/index.tsx";
const ROOT_PATH = "/project";

const variants = [
  { name: "wrap", subject: "wrap-v1", anchor: "wrap-v3", placement: "after" },
  { name: "grid", subject: "grid-v1", anchor: "grid-v3", placement: "before" },
  {
    name: "screen-root",
    subject: "root-v1",
    anchor: "root-v2",
    placement: "before",
  },
  {
    name: "modifier-flow",
    subject: "modifier-v1",
    anchor: "modifier-v2",
    placement: "after",
    forceFlowPositionOverride: true,
  },
] as const;

function elementInfo(nodeId: string, line: number): ElementInfo {
  return {
    sourceId: nodeId,
    selector: `[data-agent-native-node-id="${nodeId}"]`,
    provenance: {
      sourceFile: SOURCE_FILE,
      line,
      column: 3,
      method: "debug-source",
    },
  } as ElementInfo;
}

function state(): RecordPendingLiveStructureEditArgs {
  return {
    canEditDesign: true,
    cancelPendingStructureVerification: () => {},
    files: [
      {
        id: SCREEN_ID,
        filename: "index.tsx",
        fileType: "tsx",
        content: "",
        createdAt: "2026-09-18T00:00:00.000Z",
        updatedAt: "2026-09-18T00:00:00.000Z",
      },
    ],
    localhostConnectionRootPathByIdRef: {
      current: new Map([["connection", ROOT_PATH]]),
    },
    overviewScreens: [
      {
        id: SCREEN_ID,
        filename: "index.tsx",
        content: "",
        updatedAt: "2026-09-18T00:00:00.000Z",
        sourceType: "localhost",
        sourceFile: SOURCE_FILE,
        connectionId: "connection",
        heightPinned: true,
      },
    ],
    pendingLiveNonStyleEditsRef: { current: [] },
    pendingLiveNonStyleRedoStackRef: { current: [] },
    pendingLiveNonStyleUndoStackRef: { current: [] },
    pendingStructureRedoReplayRef: { current: undefined },
    pendingStructureRedoReplayTimerRef: { current: undefined },
    pendingVisualStyleRedoStackRef: { current: [] },
    runtimeLayerSnapshotsById: {},
    setPendingLiveNonStyleEdits: () => {},
  };
}

describe("URL-backed auto-layout variant handoffs", () => {
  it.each(variants)(
    "retains the $name runtime target and source anchors through Apply preparation",
    (variant) => {
      const editorState = state();
      const subject = elementInfo(variant.subject, 20);
      const anchor = elementInfo(variant.anchor, 24);
      const subjectSelector = subject.selector!;
      const anchorSelector = anchor.selector!;
      runRecordPendingLiveStructureEdit(
        editorState,
        SCREEN_ID,
        subjectSelector,
        anchorSelector,
        variant.placement,
        subject,
        {
          sourceId: variant.subject,
          anchorSourceId: variant.anchor,
          anchorElementInfo: anchor,
          requestId: `url-${variant.name}`,
          dropMode: "flow-insert",
          forceFlowPositionOverride:
            "forceFlowPositionOverride" in variant
              ? variant.forceFlowPositionOverride
              : undefined,
        },
      );

      const edit = editorState.pendingLiveNonStyleEditsRef.current[0];
      expect(edit?.kind).toBe("structure");
      if (edit?.kind !== "structure") return;
      expect(edit).toMatchObject({
        kind: "structure",
        screenId: SCREEN_ID,
        selector: subjectSelector,
        anchorSelector,
        sourceId: variant.subject,
        anchorSourceId: variant.anchor,
        placement: variant.placement,
        dropMode: "flow-insert",
        routeSourceFile: "src/routes/index.tsx",
        sourceAnchor: {
          id: variant.subject,
          relPath: "src/routes/index.tsx",
          line: 20,
        },
        anchorSourceAnchor: {
          id: variant.anchor,
          relPath: "src/routes/index.tsx",
          line: 24,
        },
      });
      if ("forceFlowPositionOverride" in variant) {
        expect(edit.forceFlowPositionOverride).toBe(true);
      }

      const prompt = formatPendingVisualStylePrompt({
        designId: "url-design",
        edits: [],
        liveEdits: editorState.pendingLiveNonStyleEditsRef.current,
      });
      expect(prompt).toContain(`"sourceId": "${variant.subject}"`);
      expect(prompt).toContain(`"anchorSourceId": "${variant.anchor}"`);
      expect(prompt).toContain('"dropMode": "flow-insert"');
      expect(prompt).toContain('"sourceFile": "src/routes/index.tsx"');
    },
  );
});
