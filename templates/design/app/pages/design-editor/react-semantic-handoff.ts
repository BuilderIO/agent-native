/**
 * Safe context handoff for React changes that require semantic source edits.
 *
 * This module deliberately does not transform JSX. Compiler/AST tooling may
 * verify an anchor or validate syntax elsewhere, but reparenting, grouping,
 * wrappers, conditional renders, and shared component changes belong to the
 * coding agent, which can inspect the surrounding program before editing it.
 */

export type ReactSourceScope =
  | "single-instance"
  | "repeated-render"
  | "shared-component-definition"
  | "unknown";

/** Optional while an edit is only a live canvas preview. */
export interface ReactSourceAnchor {
  id?: string;
  relPath?: string;
  sourceFile?: string;
  line?: number;
  column?: number;
  component?: string;
  runtimeMultiplicity?: number;
  reason?: string;
  scope?: ReactSourceScope;
}

export interface ExactReactSourceAnchor {
  id: string;
  relPath: string;
  sourceFile: string;
  line: number;
  column: number;
  component?: string;
  runtimeMultiplicity: number;
  reason?: string;
  scope: ReactSourceScope;
}

export type ReactSemanticOperation =
  | "move"
  | "reparent"
  | "group"
  | "ungroup"
  | "wrap"
  | "unwrap"
  | "insert"
  | "remove"
  | "auto-layout"
  | "component-change";

export type ReactRuntimeRelationshipKind =
  | "before"
  | "after"
  | "inside"
  | "wrap"
  | "unwrap"
  | "remove"
  | "style";

export interface ReactRuntimeRelationship {
  kind: ReactRuntimeRelationshipKind;
  subjectAnchorIds: readonly string[];
  targetAnchorId?: string;
  screenId?: string;
  description?: string;
}

export interface ReactSourceVersionHash {
  relPath: string;
  versionHash: string;
}

export type DeterministicWritebackRejectionCode =
  | "semantic-source-change"
  | "repeated-runtime-render"
  | "shared-component-scope"
  | "dynamic-source-expression"
  | "ambiguous-source-anchor";

export interface DeterministicWritebackRejection {
  code: DeterministicWritebackRejectionCode;
  reason: string;
}

export interface BuildReactSemanticHandoffInput {
  operation: ReactSemanticOperation;
  desiredChange: string;
  sourceAnchors: readonly ReactSourceAnchor[];
  runtimeRelationship: ReactRuntimeRelationship;
  versionHashes?: readonly ReactSourceVersionHash[];
  deterministicRejection?: DeterministicWritebackRejection;
}

export interface ReactSemanticExecutionContract {
  requiresHumanWriteConsent: true;
  requiresReadBeforeWrite: true;
  requiresExpectedVersionHash: true;
  allowsBlindOverwrite: false;
  allowsGenericAstStructureTransform: false;
  preservePreviewUntilHmrConfirmation: true;
  onVersionConflict: "re-read-and-replan";
}

export interface ReactSemanticHandoff {
  version: 1;
  executionMode: "coding-agent";
  operation: ReactSemanticOperation;
  desiredChange: string;
  sourceAnchors: ExactReactSourceAnchor[];
  runtimeRelationship: {
    kind: ReactRuntimeRelationshipKind;
    subjectAnchorIds: string[];
    targetAnchorId?: string;
    screenId?: string;
    description?: string;
  };
  versionHashes: ReactSourceVersionHash[];
  deterministicWritebackRejection: DeterministicWritebackRejection;
  executionContract: ReactSemanticExecutionContract;
  instructions: string[];
}

export type ReactSemanticHandoffBuildFailureCode =
  | "missing-source-provenance"
  | "unsafe-source-path"
  | "invalid-source-location"
  | "duplicate-anchor-id"
  | "invalid-runtime-relationship"
  | "context-limit-exceeded";

export type ReactSemanticHandoffBuildResult =
  | { ok: true; handoff: ReactSemanticHandoff }
  | {
      ok: false;
      rejection: {
        code: ReactSemanticHandoffBuildFailureCode;
        reason: string;
      };
    };

const MAX_SOURCE_ANCHORS = 8;
const MAX_VERSION_HASHES = 12;
const MAX_DESIRED_CHANGE_LENGTH = 2_000;
const MAX_REASON_LENGTH = 800;
const MAX_DESCRIPTION_LENGTH = 800;
const MAX_COMPONENT_LENGTH = 160;
const MAX_ID_LENGTH = 120;
const MAX_SCREEN_ID_LENGTH = 160;

function bounded(
  value: string | undefined,
  maxLength: number,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function safeRelativePath(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.includes("\0")) return null;
  if (/^(?:[a-z]+:|\\\\|\/)/i.test(trimmed)) return null;
  const normalized = trimmed.replace(/\\/g, "/").replace(/^\.\//, "");
  const parts = normalized.split("/");
  if (
    !normalized ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    return null;
  }
  return normalized;
}

/**
 * Bound an optional live-preview anchor for prompt serialization. Absolute
 * Fiber paths are replaced by the bridge-safe relPath when available, or
 * omitted when no safe project-relative path has been resolved yet.
 */
export function redactReactSourceAnchor(
  anchor: ReactSourceAnchor | undefined,
): ReactSourceAnchor | undefined {
  if (!anchor) return undefined;
  const relPath = safeRelativePath(anchor.relPath);
  const sourceFile = safeRelativePath(anchor.sourceFile);
  const canonicalPath = relPath ?? sourceFile;
  return {
    ...(bounded(anchor.id, MAX_ID_LENGTH)
      ? { id: bounded(anchor.id, MAX_ID_LENGTH) }
      : {}),
    ...(canonicalPath
      ? {
          relPath: canonicalPath,
          sourceFile: sourceFile ?? canonicalPath,
        }
      : {}),
    ...(Number.isInteger(anchor.line) && (anchor.line ?? 0) > 0
      ? { line: anchor.line }
      : {}),
    ...(Number.isInteger(anchor.column) && (anchor.column ?? 0) > 0
      ? { column: anchor.column }
      : {}),
    ...(bounded(anchor.component, MAX_COMPONENT_LENGTH)
      ? { component: bounded(anchor.component, MAX_COMPONENT_LENGTH) }
      : {}),
    ...(Number.isInteger(anchor.runtimeMultiplicity) &&
    (anchor.runtimeMultiplicity ?? 0) > 0
      ? { runtimeMultiplicity: anchor.runtimeMultiplicity }
      : {}),
    ...(bounded(anchor.reason, MAX_REASON_LENGTH)
      ? { reason: bounded(anchor.reason, MAX_REASON_LENGTH) }
      : {}),
    ...(anchor.scope ? { scope: anchor.scope } : {}),
  };
}

function anchorFailure(
  code: ReactSemanticHandoffBuildFailureCode,
  reason: string,
): ReactSemanticHandoffBuildResult {
  return { ok: false, rejection: { code, reason } };
}

function exactAnchor(
  anchor: ReactSourceAnchor,
  index: number,
): ExactReactSourceAnchor | ReactSemanticHandoffBuildResult {
  const relPath = safeRelativePath(anchor.relPath);
  const sourceFile = safeRelativePath(anchor.sourceFile);
  const canonicalPath = relPath ?? sourceFile;
  if (!canonicalPath) {
    if (anchor.relPath || anchor.sourceFile) {
      return anchorFailure(
        "unsafe-source-path",
        `Source anchor ${index + 1} does not include a safe project-relative path.`,
      );
    }
    return anchorFailure(
      "missing-source-provenance",
      `Source anchor ${index + 1} is missing file provenance.`,
    );
  }
  if (
    !Number.isInteger(anchor.line) ||
    !Number.isInteger(anchor.column) ||
    (anchor.line ?? 0) < 1 ||
    (anchor.column ?? 0) < 1
  ) {
    return anchorFailure(
      "invalid-source-location",
      `Source anchor ${index + 1} requires positive line and column coordinates.`,
    );
  }
  const id = bounded(anchor.id, MAX_ID_LENGTH) ?? `source-${index + 1}`;
  return {
    id,
    relPath: canonicalPath,
    // Never forward an absolute jsxDEV/Fiber path. The verified root-relative
    // path is exact for the bridge and safe to include in an agent prompt.
    sourceFile: sourceFile ?? canonicalPath,
    line: anchor.line!,
    column: anchor.column!,
    ...(bounded(anchor.component, MAX_COMPONENT_LENGTH)
      ? { component: bounded(anchor.component, MAX_COMPONENT_LENGTH) }
      : {}),
    runtimeMultiplicity:
      Number.isInteger(anchor.runtimeMultiplicity) &&
      (anchor.runtimeMultiplicity ?? 0) > 0
        ? anchor.runtimeMultiplicity!
        : 1,
    ...(bounded(anchor.reason, MAX_REASON_LENGTH)
      ? { reason: bounded(anchor.reason, MAX_REASON_LENGTH) }
      : {}),
    scope: anchor.scope ?? "unknown",
  };
}

function inferredDeterministicRejection(
  anchors: readonly ExactReactSourceAnchor[],
): DeterministicWritebackRejection {
  if (
    anchors.some((anchor) => anchor.scope === "shared-component-definition")
  ) {
    return {
      code: "shared-component-scope",
      reason:
        "The runtime node resolves to a shared component definition, so the coding agent must inspect call sites and confirm the intended instance scope.",
    };
  }
  if (
    anchors.some(
      (anchor) =>
        anchor.scope === "repeated-render" || anchor.runtimeMultiplicity > 1,
    )
  ) {
    return {
      code: "repeated-runtime-render",
      reason:
        "More than one runtime node resolves to the same source anchor, so a deterministic per-instance source edit would be unsafe.",
    };
  }
  return {
    code: "semantic-source-change",
    reason:
      "This operation changes React program structure and requires the coding agent to inspect component and control-flow semantics.",
  };
}

/**
 * Build a bounded, path-redacted context packet for the coding agent.
 * Validation failures never echo an unsafe path back to the caller.
 */
export function buildReactSemanticHandoff(
  input: BuildReactSemanticHandoffInput,
): ReactSemanticHandoffBuildResult {
  if (
    input.sourceAnchors.length === 0 ||
    input.sourceAnchors.length > MAX_SOURCE_ANCHORS ||
    (input.versionHashes?.length ?? 0) > MAX_VERSION_HASHES
  ) {
    return anchorFailure(
      "context-limit-exceeded",
      `Semantic handoff requires 1-${MAX_SOURCE_ANCHORS} anchors and at most ${MAX_VERSION_HASHES} version hashes.`,
    );
  }

  const sourceAnchors: ExactReactSourceAnchor[] = [];
  for (const [index, inputAnchor] of input.sourceAnchors.entries()) {
    const anchor = exactAnchor(inputAnchor, index);
    if ("ok" in anchor) return anchor;
    sourceAnchors.push(anchor);
  }
  const anchorIds = new Set(sourceAnchors.map((anchor) => anchor.id));
  if (anchorIds.size !== sourceAnchors.length) {
    return anchorFailure(
      "duplicate-anchor-id",
      "Every source anchor in a semantic handoff must have a unique id.",
    );
  }

  const subjectAnchorIds = input.runtimeRelationship.subjectAnchorIds.map(
    (id) => bounded(id, MAX_ID_LENGTH) ?? "",
  );
  const targetAnchorId = bounded(
    input.runtimeRelationship.targetAnchorId,
    MAX_ID_LENGTH,
  );
  if (
    subjectAnchorIds.length === 0 ||
    subjectAnchorIds.some((id) => !id || !anchorIds.has(id)) ||
    (targetAnchorId !== undefined && !anchorIds.has(targetAnchorId))
  ) {
    return anchorFailure(
      "invalid-runtime-relationship",
      "Runtime relationships must reference ids present in the bounded source anchor list.",
    );
  }

  const versionHashes: ReactSourceVersionHash[] = [];
  for (const entry of input.versionHashes ?? []) {
    const relPath = safeRelativePath(entry.relPath);
    if (!relPath) {
      return anchorFailure(
        "unsafe-source-path",
        "A version hash entry does not include a safe project-relative path.",
      );
    }
    versionHashes.push({
      relPath,
      versionHash: entry.versionHash.trim().slice(0, 256),
    });
  }

  const inferredRejection = inferredDeterministicRejection(sourceAnchors);
  const requestedRejection = input.deterministicRejection;
  const deterministicWritebackRejection = requestedRejection
    ? {
        code: requestedRejection.code,
        reason:
          bounded(requestedRejection.reason, MAX_REASON_LENGTH) ??
          inferredRejection.reason,
      }
    : inferredRejection;

  return {
    ok: true,
    handoff: {
      version: 1,
      executionMode: "coding-agent",
      operation: input.operation,
      desiredChange:
        bounded(input.desiredChange, MAX_DESIRED_CHANGE_LENGTH) ??
        "Apply the described live canvas change to the React source.",
      sourceAnchors,
      runtimeRelationship: {
        kind: input.runtimeRelationship.kind,
        subjectAnchorIds,
        ...(targetAnchorId ? { targetAnchorId } : {}),
        ...(bounded(input.runtimeRelationship.screenId, MAX_SCREEN_ID_LENGTH)
          ? {
              screenId: bounded(
                input.runtimeRelationship.screenId,
                MAX_SCREEN_ID_LENGTH,
              ),
            }
          : {}),
        ...(bounded(
          input.runtimeRelationship.description,
          MAX_DESCRIPTION_LENGTH,
        )
          ? {
              description: bounded(
                input.runtimeRelationship.description,
                MAX_DESCRIPTION_LENGTH,
              ),
            }
          : {}),
      },
      versionHashes,
      deterministicWritebackRejection,
      executionContract: {
        requiresHumanWriteConsent: true,
        requiresReadBeforeWrite: true,
        requiresExpectedVersionHash: true,
        allowsBlindOverwrite: false,
        allowsGenericAstStructureTransform: false,
        preservePreviewUntilHmrConfirmation: true,
        onVersionConflict: "re-read-and-replan",
      },
      instructions: [
        "Read every target file and verify each source anchor against the surrounding React control flow before editing.",
        "Use semantic source edits; do not apply a generic AST reparent, group, or wrapper transform.",
        "Obtain human write consent and write through the local bridge with expectedVersionHash from the corresponding read and requireExpectedVersionHash: true.",
        "If a version hash conflicts, re-read the source and re-plan instead of overwriting it.",
        "Keep the live preview pending until HMR renders and confirms the intended runtime relationship.",
      ],
    },
  };
}
