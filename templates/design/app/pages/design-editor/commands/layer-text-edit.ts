import {
  buildCodeLayerProjection,
  type CodeLayerNode,
  type CodeLayerProjection,
} from "@shared/code-layer";
import { sourceContentHash } from "@shared/source-workspace";

import {
  elementInfoFromCodeLayerNode,
  preferredCodeLayerSelector,
} from "../code-layer-state";
import type { TextCommitStatus } from "../command-types";
import type { OverviewScreen } from "../derive/overview-screens";
import type { EditorScreenChangeHandlers } from "../domains/use-editor-screen-change-handlers";
import { resolveOverviewScreenSourceType } from "../pending-edits";

function sidebarEditableLayerText(
  content: string,
  projection: CodeLayerProjection,
  node: CodeLayerNode,
): string | null {
  const span = node.source;
  if (
    !span ||
    span.contentStart === undefined ||
    span.contentEnd === undefined ||
    node.children.length > 0 ||
    node.repeatXFor
  )
    return null;
  let current: CodeLayerNode | undefined = node;
  while (current) {
    if (
      Object.keys(current.attributes).some(
        (name) =>
          name === "x-text" ||
          name === "x-html" ||
          name === "x-for" ||
          name === "x-if",
      )
    )
      return null;
    current = projection.nodes.find(
      (candidate) => candidate.id === current?.parentId,
    );
  }
  const raw = content.slice(span.contentStart, span.contentEnd);
  if (/\{\{|\$\{|[\r\n]/.test(raw)) return null;
  const template = document.createElement("template");
  template.innerHTML = raw;
  if (
    Array.from(template.content.childNodes).some(
      (child) => child.nodeType !== Node.TEXT_NODE,
    )
  )
    return null;
  const value = template.content.textContent ?? "";
  return /\{\{|\$\{|[\r\n]/.test(value) ? null : value;
}

interface LayerTextEditArgs {
  activeFileId: string | undefined;
  canEditDesign: boolean;
  designSourceType: "inline" | "localhost" | "fusion";
  getOwner: (
    id: string,
  ) =>
    | { fileId: string; node: CodeLayerNode; runtimeOnly: boolean }
    | undefined;
  getFreshActiveContent: () => string;
  getScreenContent: (screenId: string) => string;
  lockedIds: ReadonlySet<string>;
  liveScreenSnapshotsById: Readonly<Record<string, unknown>>;
  overviewScreens: OverviewScreen[];
  handleScreenTextContentChange: EditorScreenChangeHandlers["handleScreenTextContentChange"];
}

export interface LayerTextEditSession {
  layerId: string;
  screenId: string;
  selector: string;
  originalValue: string;
  sourceHash: string;
}

export function beginLayerTextEdit(
  args: LayerTextEditArgs,
  layerId: string,
): LayerTextEditSession | null {
  const owner = args.getOwner(layerId);
  if (
    !owner ||
    owner.runtimeOnly ||
    !args.canEditDesign ||
    args.lockedIds.has(layerId)
  )
    return null;
  const screen = args.overviewScreens.find(
    (candidate) => candidate.id === owner.fileId,
  );
  if (
    resolveOverviewScreenSourceType(screen, args.designSourceType) !==
      "inline" ||
    args.liveScreenSnapshotsById[owner.fileId]
  )
    return null;
  const content =
    owner.fileId === args.activeFileId
      ? args.getFreshActiveContent()
      : args.getScreenContent(owner.fileId);
  const projection = buildCodeLayerProjection(content, {
    source: { kind: "design-file", fileId: owner.fileId },
  });
  const node = projection.nodes.find((candidate) => candidate.id === layerId);
  if (!node) return null;
  const value = sidebarEditableLayerText(content, projection, node);
  return value === null
    ? null
    : {
        layerId,
        screenId: owner.fileId,
        selector: preferredCodeLayerSelector(node),
        originalValue: value,
        sourceHash: sourceContentHash(content),
      };
}

export function commitLayerTextEdit(
  args: LayerTextEditArgs,
  session: LayerTextEditSession,
  value: string,
): TextCommitStatus | "stale" {
  const current = beginLayerTextEdit(args, session.layerId);
  if (
    !current ||
    current.screenId !== session.screenId ||
    current.selector !== session.selector ||
    current.originalValue !== session.originalValue ||
    current.sourceHash !== session.sourceHash
  )
    return "stale";
  const owner = args.getOwner(session.layerId);
  if (!owner) return "stale";
  const info = elementInfoFromCodeLayerNode(owner.node);
  return args.handleScreenTextContentChange(
    session.screenId,
    session.selector,
    value,
    {
      ...info,
      sourceLayerIdentity: {
        screenId: session.screenId,
        nodeId: session.layerId,
      },
    },
  );
}
