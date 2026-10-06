import {
  buildCodeLayerProjection,
  type CodeLayerNode,
} from "@shared/code-layer";
import { parse, type DefaultTreeAdapterMap } from "parse5";

import {
  collapsedElementText,
  resolveCodeLayerTargetFromBridge,
} from "./code-layer-state";
import {
  normalizeRuntimeStructureClasses,
  normalizeRuntimeStructureText,
  pendingLiveStructureEditsFromEdit,
  type PendingLiveStructureEdit,
  type RuntimeStructureNodeSignature,
} from "./pending-edits";

export type RuntimeStructureVerificationFailure =
  | "missing-subject"
  | "ambiguous-subject"
  | "subject-still-present"
  | "missing-replacement"
  | "missing-replacement-evidence"
  | "replacement-context-changed"
  | "ambiguous-replacement"
  | "missing-anchor"
  | "ambiguous-anchor"
  | "wrong-parent"
  | "wrong-order"
  | "wrong-drop-mode"
  | "wrong-grid-placement";

export interface RuntimeStructureVerificationResult {
  ok: boolean;
  failure?: RuntimeStructureVerificationFailure;
}

type RuntimeStructureNodeRole = "subject" | "replacement" | "anchor";

interface RuntimeStructureNodeResolution {
  node?: CodeLayerNode;
  failure?: RuntimeStructureVerificationFailure;
}

function runtimeStructureResolutionFailure(
  status: "absent" | "ambiguous",
  role: RuntimeStructureNodeRole,
): RuntimeStructureVerificationFailure {
  if (status === "ambiguous") {
    if (role === "subject") return "ambiguous-subject";
    if (role === "replacement") return "ambiguous-replacement";
    return "ambiguous-anchor";
  }
  if (role === "subject") return "missing-subject";
  if (role === "replacement") return "missing-replacement";
  return "missing-anchor";
}

function runtimeStructureNodeMatchesSignature(
  node: CodeLayerNode,
  signature: RuntimeStructureNodeSignature,
): boolean {
  const component = (
    node.componentInstance?.name ??
    node.dataAttributes["data-agent-native-component"]
  )?.trim();
  return (
    node.tag.toLowerCase() === signature.tag &&
    normalizeRuntimeStructureText(collapsedElementText(node.textSnippet)) ===
      signature.text &&
    normalizeRuntimeStructureClasses(node.classes).join("\0") ===
      normalizeRuntimeStructureClasses(signature.classes).join("\0") &&
    (!signature.component || !component || component === signature.component)
  );
}

function resolveRuntimeStructureNode(args: {
  projection: { nodes: CodeLayerNode[] };
  selector?: string;
  sourceId?: string | null;
  signature?: RuntimeStructureNodeSignature;
  role: RuntimeStructureNodeRole;
}): RuntimeStructureNodeResolution {
  const direct = resolveCodeLayerTargetFromBridge(
    args.projection,
    args.selector,
    args.sourceId ?? undefined,
  );
  if (direct.status === "resolved") {
    if (
      !args.signature ||
      runtimeStructureNodeMatchesSignature(direct.node, args.signature)
    ) {
      return { node: direct.node };
    }
    return {
      failure:
        args.role === "subject"
          ? "subject-still-present"
          : args.role === "replacement"
            ? "missing-replacement"
            : "missing-anchor",
    };
  }
  if (direct.status === "ambiguous") {
    return {
      failure: runtimeStructureResolutionFailure("ambiguous", args.role),
    };
  }

  return resolveRuntimeStructureNodeBySignature(args);
}

function resolveRuntimeStructureNodeBySignature(args: {
  projection: { nodes: CodeLayerNode[] };
  signature?: RuntimeStructureNodeSignature;
  role: RuntimeStructureNodeRole;
  excludedNode?: CodeLayerNode;
}): RuntimeStructureNodeResolution {
  if (!args.signature) {
    return { failure: runtimeStructureResolutionFailure("absent", args.role) };
  }
  const matches = args.projection.nodes.filter(
    (node) =>
      node !== args.excludedNode &&
      runtimeStructureNodeMatchesSignature(node, args.signature!),
  );
  if (matches.length === 1) {
    return { node: matches[0] };
  }
  return {
    failure: runtimeStructureResolutionFailure(
      matches.length > 1 ? "ambiguous" : "absent",
      args.role,
    ),
  };
}

function verifyRuntimeStructureSubjectAbsent(
  projection: { nodes: CodeLayerNode[] },
  edit: PendingLiveStructureEdit,
  replacement?: CodeLayerNode,
): RuntimeStructureVerificationResult {
  const subject = resolveCodeLayerTargetFromBridge(
    projection,
    edit.sourceId ? undefined : edit.selector,
    edit.sourceId ?? undefined,
  );
  if (subject.status === "ambiguous") {
    return { ok: false, failure: "ambiguous-subject" };
  }
  if (
    subject.status === "resolved" &&
    (edit.sourceId ||
      replacement === undefined ||
      (subject.node === replacement &&
        (!edit.subjectSignature ||
          runtimeStructureNodeMatchesSignature(
            subject.node,
            edit.subjectSignature,
          ))))
  ) {
    return { ok: false, failure: "subject-still-present" };
  }

  const replacementTarget = resolveCodeLayerTargetFromBridge(
    projection,
    edit.replacementSourceId ? undefined : edit.replacementSelector,
    edit.replacementSourceId ?? undefined,
  );
  const signature = resolveRuntimeStructureNodeBySignature({
    projection,
    signature: edit.subjectSignature,
    role: "subject",
    excludedNode:
      replacementTarget.status === "resolved" &&
      replacementTarget.node === replacement
        ? replacement
        : undefined,
  });
  if (signature.failure === "ambiguous-subject") {
    return { ok: false, failure: signature.failure };
  }
  return signature.node
    ? { ok: false, failure: "subject-still-present" }
    : { ok: true };
}

function gridRange(value: string | undefined): [number, number] | undefined {
  if (!value) return undefined;
  const parts = value.split("/").map((part) => part.trim());
  const start = Number(parts[0]);
  if (!Number.isInteger(start)) return undefined;
  if (parts.length === 1) return [start, start + 1];
  const end = Number(parts[1]);
  return Number.isInteger(end) ? [start, end] : undefined;
}

function gridLine(value: string, start?: number): number | undefined {
  const line = Number(value);
  if (Number.isInteger(line)) return line;
  const span = /^span\s+(\d+)$/i.exec(value)?.[1];
  return span && start !== undefined ? start + Number(span) : undefined;
}

function gridPlacementFromStyle(style: CodeLayerNode["style"]):
  | {
      column: number;
      columnEnd: number;
      row: number;
      rowEnd: number;
    }
  | undefined {
  const area = style["grid-area"]?.split("/").map((part) => part.trim());
  const column = gridRange(style["grid-column"]);
  const row = gridRange(style["grid-row"]);
  if (area?.length === 4) {
    const rowStart = gridLine(area[0]);
    const columnStart = gridLine(area[1]);
    const rowEnd =
      rowStart === undefined ? undefined : gridLine(area[2], rowStart);
    const columnEnd =
      columnStart === undefined ? undefined : gridLine(area[3], columnStart);
    if (
      rowStart !== undefined &&
      columnStart !== undefined &&
      rowEnd !== undefined &&
      columnEnd !== undefined
    ) {
      return {
        row: rowStart,
        column: columnStart,
        rowEnd,
        columnEnd,
      };
    }
  }
  return column && row
    ? {
        column: column[0],
        columnEnd: column[1],
        row: row[0],
        rowEnd: row[1],
      }
    : undefined;
}

function verifyGridPlacement(
  projection: { nodes: CodeLayerNode[] },
  edit: PendingLiveStructureEdit,
  subject: CodeLayerNode,
): RuntimeStructureVerificationResult {
  if (!edit.gridPlacement) return { ok: true };
  const actual = gridPlacementFromStyle(subject.style);
  if (
    !actual ||
    actual.column !== edit.gridPlacement.column ||
    actual.columnEnd !== edit.gridPlacement.columnEnd ||
    actual.row !== edit.gridPlacement.row ||
    actual.rowEnd !== edit.gridPlacement.rowEnd
  ) {
    return { ok: false, failure: "wrong-grid-placement" };
  }
  for (const displacement of edit.gridDisplacements ?? []) {
    const resolution = resolveRuntimeStructureNode({
      projection,
      selector: displacement.selector,
      sourceId: displacement.sourceId,
      role: "subject",
    });
    if (!resolution.node) return { ok: false, failure: "wrong-grid-placement" };
    const displacedPlacement = gridPlacementFromStyle(resolution.node.style);
    if (
      !displacedPlacement ||
      displacedPlacement.column !== displacement.placement.column ||
      displacedPlacement.columnEnd !== displacement.placement.columnEnd ||
      displacedPlacement.row !== displacement.placement.row ||
      displacedPlacement.rowEnd !== displacement.placement.rowEnd
    ) {
      return { ok: false, failure: "wrong-grid-placement" };
    }
  }
  return { ok: true };
}

const runtimeSnapshotMetadataAttributes = new Set([
  "style",
  "data-agent-native-node-id",
  "data-agent-native-node-rewrite-proposal",
  "data-agent-native-group-runtime-state",
  "data-agent-native-runtime-hidden",
  "data-agent-native-runtime-locked",
  "data-agent-native-previous-display",
  "data-agent-native-text-editing",
  "data-an-runtime-layer-snapshot",
  "data-an-pending-node-id",
  "data-an-state-preview",
  "data-an-state-preview-key",
  "data-an-vector-logical-width",
  "data-an-vector-stroke-defs",
  "data-an-vector-stroke-geometry",
  "data-an-vector-stroke-original-overflow",
  "data-an-vector-stroke-original-overflow-priority",
  "data-an-vector-stroke-overlay",
  "data-an-vector-stroke-position",
  "data-source-framework",
  "data-source-file",
  "data-source-line",
  "data-source-method",
  "data-source-column",
  "data-component-name",
  "data-source-owner-file",
  "data-source-owner-line",
  "data-source-owner-column",
  "data-source-owner-component",
  "data-source-owner-method",
  "data-source-owner-key",
  "data-source-unavailable",
]);

export function runtimeStructureSnapshotSignature(
  snapshotHtml: string,
): string {
  function structure(node: DefaultTreeAdapterMap["node"]): unknown[] {
    if ("value" in node && node.nodeName === "#text") {
      const text = collapsedElementText(node.value);
      return text ? [text] : [];
    }
    if ("tagName" in node && node.tagName === "head") return [];
    const children =
      "childNodes" in node ? node.childNodes.flatMap(structure) : [];
    if (!("tagName" in node) || node.tagName === "html") return children;
    return [
      [
        node.namespaceURI,
        node.tagName,
        normalizeRuntimeStructureClasses(
          (
            node.attrs.find((attribute) => attribute.name === "class")?.value ??
            ""
          ).split(/\s+/),
        ),
        node.attrs
          .filter(
            (attribute) =>
              attribute.namespace ||
              (attribute.name !== "class" &&
                !runtimeSnapshotMetadataAttributes.has(attribute.name)),
          )
          .map((attribute) =>
            JSON.stringify([
              attribute.namespace ?? "",
              attribute.name,
              attribute.value,
            ]),
          )
          .sort(),
        children,
      ],
    ];
  }
  return JSON.stringify(structure(parse(snapshotHtml)));
}

function runtimeStructureNodeForNoOp(
  projection: { nodes: CodeLayerNode[] },
  selector: string,
  sourceId: string | null | undefined,
  signature: RuntimeStructureNodeSignature | undefined,
  role: RuntimeStructureNodeRole,
): CodeLayerNode | null {
  return (
    resolveRuntimeStructureNode({
      projection,
      selector,
      sourceId,
      signature,
      role,
    }).node ?? null
  );
}

export function verifyPendingStructureRuntime(
  snapshotHtml: string,
  edit: PendingLiveStructureEdit,
): RuntimeStructureVerificationResult {
  const projection = buildCodeLayerProjection(snapshotHtml);
  if (edit.replaced) {
    const replacementResolution = resolveRuntimeStructureNode({
      projection,
      selector: edit.replacementSourceId ? undefined : edit.replacementSelector,
      sourceId: edit.replacementSourceId,
      signature: edit.replacementSignature,
      role: "replacement",
    });
    if (!replacementResolution.node) {
      return {
        ok: false,
        failure: replacementResolution.failure ?? "missing-replacement",
      };
    }

    const absence = verifyRuntimeStructureSubjectAbsent(
      projection,
      edit,
      replacementResolution.node,
    );
    if (!absence.ok) return absence;
    if (!edit.replacementSnapshotSignature) {
      return { ok: false, failure: "missing-replacement-evidence" };
    }
    return runtimeStructureSnapshotSignature(snapshotHtml) ===
      edit.replacementSnapshotSignature
      ? { ok: true }
      : { ok: false, failure: "replacement-context-changed" };
  }
  if (edit.removed) {
    return verifyRuntimeStructureSubjectAbsent(projection, edit);
  }

  const subjectResolution = resolveRuntimeStructureNode({
    projection,
    selector: edit.selector,
    sourceId: edit.sourceId,
    signature: edit.subjectSignature,
    role: "subject",
  });
  const subject = subjectResolution.node;
  if (!subject) {
    return {
      ok: false,
      failure: subjectResolution.failure ?? "missing-subject",
    };
  }
  const anchorResolution = resolveRuntimeStructureNode({
    projection,
    selector: edit.anchorSelector,
    sourceId: edit.anchorSourceId,
    signature: edit.anchorSignature,
    role: "anchor",
  });
  const anchor = anchorResolution.node;
  if (!anchor) {
    return {
      ok: false,
      failure: anchorResolution.failure ?? "missing-anchor",
    };
  }

  if (edit.placement === "inside") {
    if (subject.parentId !== anchor.id) {
      return { ok: false, failure: "wrong-parent" };
    }
  } else {
    if (subject.parentId !== anchor.parentId) {
      return { ok: false, failure: "wrong-parent" };
    }
    const siblings = anchor.parentId
      ? (projection.nodes.find((node) => node.id === anchor.parentId)
          ?.children ?? [])
      : projection.nodes
          .filter((node) => !node.parentId)
          .map((node) => node.id);
    const subjectIndex = siblings.indexOf(subject.id);
    const anchorIndex = siblings.indexOf(anchor.id);
    const expectedDelta = edit.placement === "before" ? -1 : 1;
    if (
      subjectIndex < 0 ||
      anchorIndex < 0 ||
      subjectIndex - anchorIndex !== expectedDelta
    ) {
      return { ok: false, failure: "wrong-order" };
    }
  }

  const position = subject.style.position?.trim().toLowerCase() ?? "static";
  if (edit.dropMode === "absolute-container" && position !== "absolute") {
    return { ok: false, failure: "wrong-drop-mode" };
  }
  if (
    edit.dropMode === "flow-insert" &&
    (position === "absolute" || position === "fixed")
  ) {
    return { ok: false, failure: "wrong-drop-mode" };
  }

  const gridResult = verifyGridPlacement(projection, edit, subject);
  if (!gridResult.ok) return gridResult;

  return { ok: true };
}

function verifyPendingStructureGroupRuntime(
  snapshotHtml: string,
  edits: readonly PendingLiveStructureEdit[],
): RuntimeStructureVerificationResult {
  const projection = buildCodeLayerProjection(snapshotHtml);
  const resolutions = edits.map((edit) => ({
    edit,
    subject: resolveRuntimeStructureNode({
      projection,
      selector: edit.selector,
      sourceId: edit.sourceId,
      signature: edit.subjectSignature,
      role: "subject",
    }),
    anchor: resolveRuntimeStructureNode({
      projection,
      selector: edit.anchorSelector,
      sourceId: edit.anchorSourceId,
      signature: edit.anchorSignature,
      role: "anchor",
    }),
  }));
  for (const { edit, subject, anchor } of resolutions) {
    if (!subject.node) {
      return {
        ok: false,
        failure: subject.failure ?? "missing-subject",
      };
    }
    if (!anchor.node) {
      return {
        ok: false,
        failure: anchor.failure ?? "missing-anchor",
      };
    }
    const position =
      subject.node.style.position?.trim().toLowerCase() ?? "static";
    if (
      (edit.dropMode === "absolute-container" && position !== "absolute") ||
      (edit.dropMode === "flow-insert" &&
        (position === "absolute" || position === "fixed"))
    ) {
      return { ok: false, failure: "wrong-drop-mode" };
    }
    const gridResult = verifyGridPlacement(projection, edit, subject.node);
    if (!gridResult.ok) return gridResult;
  }

  const subjects = resolutions.map(({ subject }) => subject.node!);
  const subjectIds = new Set(subjects.map((subject) => subject.id));
  const parentIds = new Set(subjects.map((subject) => subject.parentId ?? ""));
  if (parentIds.size !== 1) return { ok: false, failure: "wrong-parent" };
  const parentId = subjects[0]?.parentId;
  const siblings = parentId
    ? (projection.nodes.find((node) => node.id === parentId)?.children ?? [])
    : projection.nodes.filter((node) => !node.parentId).map((node) => node.id);
  const subjectIndexes = subjects.map((subject) =>
    siblings.indexOf(subject.id),
  );
  if (subjectIndexes.some((index) => index < 0)) {
    return { ok: false, failure: "wrong-order" };
  }
  const sortedIndexes = [...subjectIndexes].sort((left, right) => left - right);
  if (
    sortedIndexes.some(
      (index, position) => index !== sortedIndexes[0]! + position,
    )
  ) {
    return { ok: false, failure: "wrong-order" };
  }

  const externalAnchors = resolutions.filter(
    ({ edit, anchor }) =>
      edit.placement !== "inside" && !subjectIds.has(anchor.node!.id),
  );
  for (const { edit, anchor } of externalAnchors) {
    if (anchor.node!.parentId !== parentId) {
      return { ok: false, failure: "wrong-parent" };
    }
    const anchorIndex = siblings.indexOf(anchor.node!.id);
    if (anchorIndex < 0) return { ok: false, failure: "wrong-order" };
    if (
      (edit.placement === "before" &&
        sortedIndexes[sortedIndexes.length - 1] !== anchorIndex - 1) ||
      (edit.placement === "after" && sortedIndexes[0] !== anchorIndex + 1)
    ) {
      return { ok: false, failure: "wrong-order" };
    }
  }
  for (const { edit, subject, anchor } of resolutions) {
    if (!subjectIds.has(anchor.node!.id) || edit.placement === "inside") {
      if (
        edit.placement === "inside" &&
        subject.node!.parentId !== anchor.node!.id
      ) {
        return { ok: false, failure: "wrong-parent" };
      }
      continue;
    }
    const subjectIndex = siblings.indexOf(subject.node!.id);
    const anchorIndex = siblings.indexOf(anchor.node!.id);
    const expectedDelta = edit.placement === "before" ? -1 : 1;
    if (subjectIndex - anchorIndex !== expectedDelta) {
      return { ok: false, failure: "wrong-order" };
    }
  }
  return { ok: true };
}

export function isPendingStructureDropNoOp(
  snapshotHtml: string | undefined,
  edit: PendingLiveStructureEdit,
): boolean {
  if (!snapshotHtml || edit.insertedHtml || edit.replaced || edit.removed) {
    return false;
  }
  const projection = buildCodeLayerProjection(snapshotHtml);
  const subject = runtimeStructureNodeForNoOp(
    projection,
    edit.selector,
    edit.sourceId,
    edit.subjectSignature,
    "subject",
  );
  const anchor = runtimeStructureNodeForNoOp(
    projection,
    edit.anchorSelector,
    edit.anchorSourceId,
    edit.anchorSignature,
    "anchor",
  );
  if (!subject || !anchor) return false;
  if (edit.placement === "inside") {
    return (
      edit.dropMode !== "absolute-container" && subject.parentId === anchor.id
    );
  }
  if (subject.parentId !== anchor.parentId) return false;
  const siblings = subject.parentId
    ? (projection.nodes.find((node) => node.id === subject.parentId)
        ?.children ?? [])
    : projection.nodes.filter((node) => !node.parentId).map((node) => node.id);
  const subjectIndex = siblings.indexOf(subject.id);
  const anchorIndex = siblings.indexOf(anchor.id);
  return (
    subjectIndex >= 0 &&
    anchorIndex >= 0 &&
    subjectIndex - anchorIndex === (edit.placement === "before" ? -1 : 1)
  );
}

function replacementSnapshotsByScreen(
  edits: readonly PendingLiveStructureEdit[],
) {
  return new Map(
    edits
      .flatMap((edit) => pendingLiveStructureEditsFromEdit(edit))
      .filter((edit) => edit.replaced)
      .map((edit) => [edit.screenId, edit.replacementSnapshotSignature]),
  );
}

export function verifyPendingStructuresRuntime(
  snapshots: Record<string, { html: string } | undefined>,
  edits: readonly PendingLiveStructureEdit[],
): RuntimeStructureVerificationResult {
  const replacementSnapshots = replacementSnapshotsByScreen(edits);
  for (const entry of edits) {
    const members = pendingLiveStructureEditsFromEdit(entry);
    const snapshot = snapshots[entry.screenId];
    if (!snapshot) return { ok: false, failure: "missing-subject" };
    if (members.length > 1) {
      const result = verifyPendingStructureGroupRuntime(snapshot.html, members);
      if (!result.ok) return result;
      continue;
    }
    for (const edit of members) {
      const snapshot = snapshots[edit.screenId];
      if (!snapshot) return { ok: false, failure: "missing-subject" };
      const result = verifyPendingStructureRuntime(snapshot.html, {
        ...edit,
        replacementSnapshotSignature: replacementSnapshots.get(edit.screenId),
      });
      if (!result.ok) return result;
    }
  }
  return { ok: true };
}

export function partitionPendingStructuresRuntime(
  snapshots: Record<string, { html: string } | undefined>,
  edits: readonly PendingLiveStructureEdit[],
): {
  verified: PendingLiveStructureEdit[];
  remaining: PendingLiveStructureEdit[];
} {
  const replacementSnapshots = replacementSnapshotsByScreen(edits);
  const results = edits.map((edit) => {
    const snapshot = snapshots[edit.screenId];
    const members = pendingLiveStructureEditsFromEdit(edit);
    const ok = Boolean(
      snapshot &&
      (members.length > 1
        ? verifyPendingStructureGroupRuntime(snapshot.html, members).ok
        : members.every(
            (member) =>
              verifyPendingStructureRuntime(snapshot.html, {
                ...member,
                replacementSnapshotSignature: replacementSnapshots.get(
                  member.screenId,
                ),
              }).ok,
          )),
    );
    return {
      edit,
      ok,
    };
  });
  const blockedScreens = new Set(
    results
      .filter(({ edit, ok }) => edit.replaced && !ok)
      .map(({ edit }) => edit.screenId),
  );
  const blockedTransactions = new Set(
    results
      .filter(({ edit, ok }) => edit.transactionId && !ok)
      .map(({ edit }) => edit.transactionId!),
  );
  const verified: PendingLiveStructureEdit[] = [];
  const remaining: PendingLiveStructureEdit[] = [];
  for (const { edit, ok } of results) {
    if (
      ok &&
      (!edit.replaced || !blockedScreens.has(edit.screenId)) &&
      (!edit.transactionId || !blockedTransactions.has(edit.transactionId))
    ) {
      verified.push(edit);
    } else {
      remaining.push(edit);
    }
  }
  return { verified, remaining };
}
