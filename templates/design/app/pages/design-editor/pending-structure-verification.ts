import { buildCodeLayerProjection } from "@shared/code-layer";

import { resolveCodeLayerNodeFromBridge } from "./code-layer-state";
import type { PendingLiveStructureEdit } from "./pending-edits";

export type RuntimeStructureVerificationFailure =
  | "missing-subject"
  | "subject-still-present"
  | "missing-anchor"
  | "wrong-parent"
  | "wrong-order"
  | "wrong-drop-mode";

export interface RuntimeStructureVerificationResult {
  ok: boolean;
  failure?: RuntimeStructureVerificationFailure;
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
  const subject = resolveCodeLayerNodeFromBridge(
    projection,
    edit.selector,
    edit.sourceId ?? undefined,
  );
  if (edit.replaced) {
    const replacement = resolveCodeLayerNodeFromBridge(
      projection,
      edit.replacementSelector ?? "",
      edit.replacementSourceId ?? undefined,
    );
    if (!replacement) return { ok: false, failure: "missing-subject" };
    return subject
      ? { ok: false, failure: "subject-still-present" }
      : { ok: true };
  }
  // A removal proves itself by ABSENCE. Running it through the anchor/order
  // checks below would report "missing-subject" for the exact outcome it
  // asked for, and the apply flow would sit in awaiting-runtime until it
  // timed out on a source write that actually succeeded.
  if (edit.removed) {
    return subject
      ? { ok: false, failure: "subject-still-present" }
      : { ok: true };
  }
  if (!subject) return { ok: false, failure: "missing-subject" };
  const anchor = resolveCodeLayerNodeFromBridge(
    projection,
    edit.anchorSelector,
    edit.anchorSourceId ?? undefined,
  );
  if (!anchor) return { ok: false, failure: "missing-anchor" };

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
