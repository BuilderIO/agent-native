import {
  buildCodeLayerProjection,
  type CodeLayerNode,
  type CodeLayerProjection,
} from "@shared/code-layer";
import { linkedComponentRootForNode } from "@shared/component-links";
import { sourceContentHash } from "@shared/source-workspace";

import { replaceLinkedScreenPreviewContent } from "@/components/design/multi-screen/linked-screen-preview";

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
    node.repeatXFor ||
    (!node.paintsOwnText &&
      node.dataAttributes["data-an-primitive"] !== "text" &&
      !/^(p|span|h[1-6])$/i.test(node.tag))
  )
    return null;
  let current: CodeLayerNode | undefined = node;
  while (current) {
    const openTag = current.source
      ? content.slice(current.source.openStart, current.source.openEnd)
      : "";
    if (
      /\s\[(?:textcontent|innerhtml|innertext|outerhtml)\]\s*=/i.test(
        openTag,
      ) ||
      Object.keys(current.attributes).some((name) =>
        /^(?:(?:x|v)-(?:text|html|for|if|else-if|else|effect|init|model)(?:[:.]|$)|(?:x|v)-bind(?:$|\.|:$|:\[|:(?:textcontent|innerhtml|innertext|outerhtml|text-content|inner-html|inner-text)(?:[.]|$))|:$|:\[|:(?:textcontent|innerhtml|innertext|outerhtml|text-content|inner-html|inner-text)(?:[.]|$)|\[(?:textcontent|innerhtml|innertext|outerhtml)\]|data-bind$|ng-(?:bind|bind-html|if|repeat)$|th:(?:text|utext)$)/i.test(
          name,
        ),
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
  requestPreviewRefresh: () => void;
}

export interface LayerTextEditSession {
  layerId: string;
  screenId: string;
  selector: string;
  originalValue: string;
  sourceHash: string;
  durableId: string | null;
  tag: string;
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
  if (!node || linkedComponentRootForNode(node, projection)) return null;
  const value = sidebarEditableLayerText(content, projection, node);
  const durableId = node.dataAttributes["data-agent-native-node-id"];
  if (
    durableId &&
    projection.nodes.filter(
      (candidate) =>
        candidate.dataAttributes["data-agent-native-node-id"] === durableId,
    ).length !== 1
  )
    return null;
  return value === null
    ? null
    : {
        layerId,
        screenId: owner.fileId,
        selector: preferredCodeLayerSelector(node),
        originalValue: value,
        sourceHash: sourceContentHash(content),
        durableId: durableId ?? null,
        tag: node.tag,
      };
}

export function commitLayerTextEdit(
  args: LayerTextEditArgs,
  session: LayerTextEditSession,
  value: string,
): TextCommitStatus | "stale" | "empty" {
  const current = beginLayerTextEdit(args, session.layerId);
  if (
    !current ||
    current.screenId !== session.screenId ||
    current.selector !== session.selector ||
    current.originalValue !== session.originalValue ||
    current.tag !== session.tag ||
    (session.durableId
      ? current.durableId !== session.durableId
      : current.sourceHash !== session.sourceHash)
  )
    return "stale";
  const owner = args.getOwner(session.layerId);
  if (!owner) return "stale";
  if (
    !value.trim() &&
    owner.node.dataAttributes["data-an-primitive"] !== "text" &&
    !/^(p|span|h[1-6])$/i.test(owner.node.tag)
  )
    return "empty";
  const info = elementInfoFromCodeLayerNode(owner.node);
  const status = args.handleScreenTextContentChange(
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
    { preserveEmptyText: true },
  );
  if (status === "accepted") {
    const content = args.getScreenContent(session.screenId);
    if (
      !replaceLinkedScreenPreviewContent(session.screenId, content, null, [], {
        forceFullDocument: true,
      })
    ) {
      args.requestPreviewRefresh();
    }
  }
  return status;
}
