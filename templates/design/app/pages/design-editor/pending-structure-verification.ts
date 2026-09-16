import {
  buildCodeLayerProjection,
  type CodeLayerNode,
} from "@shared/code-layer";

import {
  bridgeSourceIdForCodeLayerNode,
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
  | "missing-replacement"
  | "ambiguous-replacement"
  | "missing-anchor"
  | "ambiguous-anchor"
  | "wrong-parent"
  | "wrong-order"
  | "wrong-drop-mode";

export interface RuntimeStructureVerificationResult {
  ok: boolean;
  failure?: RuntimeStructureVerificationFailure;
}

type RuntimeStructureNodeRole = "subject" | "replacement" | "anchor";

interface RuntimeStructureNodeResolution {
  node?: CodeLayerNode;
  failure?: RuntimeStructureVerificationFailure;
  matchedBy?: "identity" | "selector" | "signature";
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
    const matchedBy =
      args.sourceId &&
      bridgeSourceIdForCodeLayerNode(direct.node) === args.sourceId
        ? "identity"
        : "selector";
    if (
      !args.signature ||
      runtimeStructureNodeMatchesSignature(direct.node, args.signature)
    ) {
      return { node: direct.node, matchedBy };
    }
    // A live identity is stronger evidence than a stale content signature.
    // Do not let an unrelated sibling with the old signature validate this
    // edit while the original runtime node is still present but changed.
    return {
      failure:
        args.role === "subject"
          ? "subject-still-present"
          : args.role === "replacement"
            ? "missing-replacement"
            : "missing-anchor",
    };
  }

  if (!args.signature) {
    return {
      failure: runtimeStructureResolutionFailure(
        direct.status === "ambiguous" ? "ambiguous" : "absent",
        args.role,
      ),
    };
  }

  const matches = args.projection.nodes.filter((node) =>
    runtimeStructureNodeMatchesSignature(node, args.signature!),
  );
  if (matches.length === 1) {
    return { node: matches[0], matchedBy: "signature" };
  }
  return {
    failure: runtimeStructureResolutionFailure(
      matches.length > 1 ? "ambiguous" : "absent",
      args.role,
    ),
  };
}

function resolveRuntimeStructureNodeByIdentity(args: {
  projection: { nodes: CodeLayerNode[] };
  selector?: string;
  sourceId?: string | null;
  role: RuntimeStructureNodeRole;
}): RuntimeStructureNodeResolution {
  const direct = resolveCodeLayerTargetFromBridge(
    args.projection,
    args.selector,
    args.sourceId ?? undefined,
  );
  if (direct.status === "resolved") {
    return {
      node: direct.node,
      matchedBy:
        args.sourceId &&
        bridgeSourceIdForCodeLayerNode(direct.node) === args.sourceId
          ? "identity"
          : "selector",
    };
  }
  return {
    failure: runtimeStructureResolutionFailure(
      direct.status === "ambiguous" ? "ambiguous" : "absent",
      args.role,
    ),
  };
}

function resolveRuntimeStructureNodeBySignature(args: {
  projection: { nodes: CodeLayerNode[] };
  signature?: RuntimeStructureNodeSignature;
  role: RuntimeStructureNodeRole;
  excludedNodeIds?: ReadonlySet<string>;
}): RuntimeStructureNodeResolution {
  if (!args.signature) {
    return { failure: runtimeStructureResolutionFailure("absent", args.role) };
  }
  const matches = args.projection.nodes.filter(
    (node) =>
      !args.excludedNodeIds?.has(node.id) &&
      runtimeStructureNodeMatchesSignature(node, args.signature!),
  );
  if (matches.length === 1) {
    return { node: matches[0], matchedBy: "signature" };
  }
  return {
    failure: runtimeStructureResolutionFailure(
      matches.length > 1 ? "ambiguous" : "absent",
      args.role,
    ),
  };
}

function resolveRuntimeStructureNodeForPresence(args: {
  projection: { nodes: CodeLayerNode[] };
  selector?: string;
  sourceId?: string | null;
  signature?: RuntimeStructureNodeSignature;
  role: RuntimeStructureNodeRole;
}): RuntimeStructureNodeResolution {
  const identity = resolveRuntimeStructureNodeByIdentity(args);
  if (identity.node || identity.failure?.startsWith("ambiguous")) {
    return identity;
  }
  return resolveRuntimeStructureNodeBySignature(args);
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
  if (edit.replaced) {
    const replacementResolution = resolveRuntimeStructureNodeForPresence({
      projection,
      selector: edit.replacementSelector,
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

    const subjectIdentityResolution = resolveRuntimeStructureNodeByIdentity({
      projection,
      selector: edit.selector,
      sourceId: edit.sourceId,
      role: "subject",
    });
    if (subjectIdentityResolution.failure === "ambiguous-subject") {
      return { ok: false, failure: "ambiguous-subject" };
    }
    if (subjectIdentityResolution.node) {
      const sameNode =
        subjectIdentityResolution.node.id === replacementResolution.node.id;
      const replacementIsProvenByPosition =
        sameNode &&
        subjectIdentityResolution.matchedBy === "selector" &&
        replacementResolution.matchedBy === "selector";
      if (!replacementIsProvenByPosition) {
        return { ok: false, failure: "subject-still-present" };
      }
    }

    const subjectMatches = projection.nodes.filter((node) =>
      edit.subjectSignature
        ? runtimeStructureNodeMatchesSignature(node, edit.subjectSignature)
        : false,
    );
    const replacementIsUniquelyLocated =
      replacementResolution.matchedBy === "identity" ||
      replacementResolution.matchedBy === "selector";
    const remainingSubjectMatches = replacementIsUniquelyLocated
      ? subjectMatches.filter(
          (node) => node.id !== replacementResolution.node!.id,
        )
      : subjectMatches;
    const replacementIsProvenByPosition =
      subjectIdentityResolution.node?.id === replacementResolution.node.id &&
      subjectIdentityResolution.matchedBy === "selector" &&
      replacementResolution.matchedBy === "selector";
    if (!replacementIsProvenByPosition) {
      if (remainingSubjectMatches.length > 1) {
        return { ok: false, failure: "ambiguous-subject" };
      }
      if (remainingSubjectMatches.length === 1) {
        return { ok: false, failure: "subject-still-present" };
      }
    }
    return { ok: true };
  }
  // A removal proves itself by ABSENCE. Running it through the anchor/order
  // checks below would report "missing-subject" for the exact outcome it
  // asked for, and the apply flow would sit in awaiting-runtime until it
  // timed out on a source write that actually succeeded.
  if (edit.removed) {
    const subjectIdentityResolution = resolveRuntimeStructureNodeByIdentity({
      projection,
      selector: edit.selector,
      sourceId: edit.sourceId,
      role: "subject",
    });
    if (subjectIdentityResolution.failure === "ambiguous-subject") {
      return { ok: false, failure: "ambiguous-subject" };
    }
    if (subjectIdentityResolution.node) {
      return { ok: false, failure: "subject-still-present" };
    }
    const subjectSignatureResolution = resolveRuntimeStructureNodeBySignature({
      projection,
      signature: edit.subjectSignature,
      role: "subject",
    });
    if (subjectSignatureResolution.failure === "ambiguous-subject") {
      return { ok: false, failure: "ambiguous-subject" };
    }
    if (subjectSignatureResolution.node) {
      return { ok: false, failure: "subject-still-present" };
    }
    return { ok: true };
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
