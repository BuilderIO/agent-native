import {
  buildCodeLayerProjection,
  type CodeLayerNode,
} from "@shared/code-layer";

import {
  collapsedElementText,
  resolveCodeLayerTargetFromBridge,
} from "./code-layer-state";
import {
  normalizeRuntimeStructureClasses,
  normalizeRuntimeStructureText,
  type PendingLiveStructureEdit,
  type RuntimeStructureNodeSignature,
} from "./pending-edits";

export type RuntimeStructureVerificationFailure =
  | "missing-subject"
  | "ambiguous-subject"
  | "subject-still-present"
  | "missing-anchor"
  | "ambiguous-anchor"
  | "wrong-parent"
  | "wrong-order"
  | "wrong-drop-mode";

export interface RuntimeStructureVerificationResult {
  ok: boolean;
  failure?: RuntimeStructureVerificationFailure;
}

type RuntimeStructureNodeRole = "subject" | "anchor";

interface RuntimeStructureNodeResolution {
  node?: CodeLayerNode;
  failure?: RuntimeStructureVerificationFailure;
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
  if (
    direct.status === "resolved" &&
    (!args.signature ||
      runtimeStructureNodeMatchesSignature(direct.node, args.signature))
  ) {
    return { node: direct.node };
  }

  if (!args.signature) {
    return {
      failure:
        direct.status === "ambiguous"
          ? args.role === "subject"
            ? "ambiguous-subject"
            : "ambiguous-anchor"
          : args.role === "subject"
            ? "missing-subject"
            : "missing-anchor",
    };
  }

  const matches = args.projection.nodes.filter((node) =>
    runtimeStructureNodeMatchesSignature(node, args.signature!),
  );
  if (matches.length === 1) return { node: matches[0] };
  return {
    failure:
      matches.length > 1
        ? args.role === "subject"
          ? "ambiguous-subject"
          : "ambiguous-anchor"
        : args.role === "subject"
          ? "missing-subject"
          : "missing-anchor",
  };
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

/**
 * Proves that a post-source-write runtime snapshot reconstructed the exact
 * optimistic relationship. This deliberately checks hierarchy/order and the
 * flow-vs-absolute contract; matching selectors alone is not confirmation.
 */
export function verifyPendingStructureRuntime(
  snapshotHtml: string,
  edit: PendingLiveStructureEdit,
): RuntimeStructureVerificationResult {
  const projection = buildCodeLayerProjection(snapshotHtml);
  const subjectResolution = resolveRuntimeStructureNode({
    projection,
    selector: edit.selector,
    sourceId: edit.sourceId,
    signature: edit.subjectSignature,
    role: "subject",
  });
  const subject = subjectResolution.node;
  if (edit.replaced) {
    const replacementResolution = resolveRuntimeStructureNode({
      projection,
      selector: edit.replacementSelector,
      sourceId: edit.replacementSourceId,
      signature: edit.replacementSignature,
      role: "subject",
    });
    if (!replacementResolution.node) {
      return {
        ok: false,
        failure: replacementResolution.failure ?? "missing-subject",
      };
    }
    if (subjectResolution.failure === "ambiguous-subject") {
      return { ok: false, failure: "ambiguous-subject" };
    }
    return subject
      ? { ok: false, failure: "subject-still-present" }
      : { ok: true };
  }
  // A removal proves itself by ABSENCE. Running it through the anchor/order
  // checks below would report "missing-subject" for the exact outcome it
  // asked for, and the apply flow would sit in awaiting-runtime until it
  // timed out on a source write that actually succeeded.
  if (edit.removed) {
    if (subjectResolution.failure === "ambiguous-subject") {
      return { ok: false, failure: "ambiguous-subject" };
    }
    return subject
      ? { ok: false, failure: "subject-still-present" }
      : { ok: true };
  }
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
  if (edit.placement === "inside") return subject.parentId === anchor.id;
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

export function verifyPendingStructuresRuntime(
  snapshots: Record<string, { html: string } | undefined>,
  edits: readonly PendingLiveStructureEdit[],
): RuntimeStructureVerificationResult {
  for (const edit of edits) {
    const snapshot = snapshots[edit.screenId];
    if (!snapshot) return { ok: false, failure: "missing-subject" };
    const result = verifyPendingStructureRuntime(snapshot.html, edit);
    if (!result.ok) return result;
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
  const verified: PendingLiveStructureEdit[] = [];
  const remaining: PendingLiveStructureEdit[] = [];
  for (const edit of edits) {
    const snapshot = snapshots[edit.screenId];
    if (snapshot && verifyPendingStructureRuntime(snapshot.html, edit).ok) {
      verified.push(edit);
    } else {
      remaining.push(edit);
    }
  }
  return { verified, remaining };
}
