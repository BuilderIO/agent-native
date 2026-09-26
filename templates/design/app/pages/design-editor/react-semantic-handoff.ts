
import {
  type ElementProvenanceMethod,
  sourcePositionPrecision,
  type SourcePositionPrecision,
} from "@shared/source-mode";

export type ReactSourceScope =
  | "single-instance"
  | "repeated-render"
  | "shared-component-definition"
  | "unknown";

export interface ReactSourceAnchor {
  id?: string;
  relPath?: string;
  sourceFile?: string;
  line?: number;
  column?: number;
  method?: ElementProvenanceMethod;
  component?: string;
  ownerRelPath?: string;
  ownerSourceFile?: string;
  ownerLine?: number;
  ownerColumn?: number;
  ownerComponent?: string;
  ownerMethod?: ElementProvenanceMethod;
  ownerKey?: string;
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
  positionPrecision: SourcePositionPrecision;
  method?: ElementProvenanceMethod;
  component?: string;
  ownerRelPath?: string;
  ownerSourceFile?: string;
  ownerLine?: number;
  ownerColumn?: number;
  ownerComponent?: string;
  ownerMethod?: ElementProvenanceMethod;
  ownerPositionPrecision?: SourcePositionPrecision;
  ownerKey?: string;
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
  | "replace"
  | "remove"
  | "auto-layout"
  | "set-layer-state"
  | "metadata"
  | "component-change";

export type ReactRuntimeRelationshipKind =
  | "before"
  | "after"
  | "inside"
  | "replace"
  | "wrap"
  | "unwrap"
  | "remove"
  | "style"
  | "metadata";

export interface ReactRuntimeRelationship {
  kind: ReactRuntimeRelationshipKind;
  subjectAnchorIds: readonly string[];
  targetAnchorId?: string;
  screenId?: string;
  sourceScreenId?: string;
  targetScreenId?: string;
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
    sourceScreenId?: string;
    targetScreenId?: string;
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
const MAX_SOURCE_PATH_LENGTH = 1_000;

export interface BuildRuntimeReactStructureMoveHandoffInput {
  subjectAnchor: ReactSourceAnchor;
  targetAnchor: ReactSourceAnchor;
  placement: "before" | "after" | "inside";
  sourceScreenId: string;
  targetScreenId: string;
}

export type RuntimeReactLayerState = "locked" | "hidden";

export interface BuildRuntimeReactLayerStateHandoffInput {
  subjectAnchor: ReactSourceAnchor;
  screenId: string;
  state: RuntimeReactLayerState;
  enabled: boolean;
}

export type RuntimeStructureMoveExecutionMode =
  | "source-edit"
  | "screen-bridge"
  | "screen-bridge-insert"
  | "semantic-handoff";

export function resolveRuntimeStructureMoveExecutionMode(input: {
  subjectRuntimeOnly: boolean;
  targetRuntimeOnly: boolean;
  sourceScreenId: string;
  targetScreenId: string;
  targetScreenIsLive?: boolean;
  sourceScreenIsBoard?: boolean;
}): RuntimeStructureMoveExecutionMode {
  if (
    input.targetScreenIsLive &&
    input.sourceScreenIsBoard &&
    input.sourceScreenId !== input.targetScreenId
  ) {
    return "screen-bridge-insert";
  }
  if (input.targetScreenIsLive && input.sourceScreenId !== input.targetScreenId)
    return "semantic-handoff";
  if (!input.subjectRuntimeOnly && !input.targetRuntimeOnly)
    return "source-edit";
  if (
    input.subjectRuntimeOnly &&
    input.targetRuntimeOnly &&
    input.sourceScreenId === input.targetScreenId
  ) {
    return "screen-bridge";
  }
  return "semantic-handoff";
}

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

function ownerAnchorFields(anchor: ReactSourceAnchor) {
  const ownerPath =
    safeRelativePath(anchor.ownerRelPath) ??
    safeRelativePath(anchor.ownerSourceFile);
  const rawOwnerPath =
    bounded(anchor.ownerRelPath, MAX_SOURCE_PATH_LENGTH) ??
    bounded(anchor.ownerSourceFile, MAX_SOURCE_PATH_LENGTH);
  const hasOwnerPosition =
    !!ownerPath &&
    Number.isInteger(anchor.ownerLine) &&
    (anchor.ownerLine ?? 0) > 0;
  return {
    ...(hasOwnerPosition
      ? {
          ownerRelPath: ownerPath,
          ownerSourceFile:
            safeRelativePath(anchor.ownerSourceFile) ?? ownerPath,
          ownerLine: anchor.ownerLine!,
          ownerPositionPrecision: sourcePositionPrecision(anchor.ownerMethod),
          ...(Number.isInteger(anchor.ownerColumn) &&
          (anchor.ownerColumn ?? 0) > 0
            ? { ownerColumn: anchor.ownerColumn }
            : {}),
          ...(anchor.ownerMethod ? { ownerMethod: anchor.ownerMethod } : {}),
        }
      : rawOwnerPath
        ? {
            ownerSourceFile: rawOwnerPath,
            ownerSourcePathStatus: "outside-connected-root" as const,
            ...(Number.isInteger(anchor.ownerLine) &&
            (anchor.ownerLine ?? 0) > 0
              ? { ownerLine: anchor.ownerLine }
              : {}),
            ...(Number.isInteger(anchor.ownerColumn) &&
            (anchor.ownerColumn ?? 0) > 0
              ? { ownerColumn: anchor.ownerColumn }
              : {}),
            ...(anchor.ownerMethod ? { ownerMethod: anchor.ownerMethod } : {}),
          }
        : {}),
    ...(bounded(anchor.ownerComponent, MAX_COMPONENT_LENGTH)
      ? { ownerComponent: bounded(anchor.ownerComponent, MAX_COMPONENT_LENGTH) }
      : {}),
    ...(bounded(anchor.ownerKey, MAX_ID_LENGTH)
      ? { ownerKey: bounded(anchor.ownerKey, MAX_ID_LENGTH) }
      : {}),
  };
}

export type RedactedReactSourceAnchor = ReactSourceAnchor & {
  positionPrecision: SourcePositionPrecision;
  sourcePathStatus?: "outside-connected-root";
  ownerSourcePathStatus?: "outside-connected-root";
};

export function redactReactSourceAnchor(
  anchor: ReactSourceAnchor | undefined,
): RedactedReactSourceAnchor | undefined {
  if (!anchor) return undefined;
  const relPath = safeRelativePath(anchor.relPath);
  const rawSourceFile = bounded(anchor.sourceFile, MAX_SOURCE_PATH_LENGTH);
  const sourceFile = safeRelativePath(rawSourceFile);
  const canonicalPath = relPath ?? sourceFile;
  return {
    positionPrecision: sourcePositionPrecision(anchor.method),
    ...(bounded(anchor.id, MAX_ID_LENGTH)
      ? { id: bounded(anchor.id, MAX_ID_LENGTH) }
      : {}),
    ...(canonicalPath
      ? {
          relPath: canonicalPath,
          sourceFile: sourceFile ?? canonicalPath,
        }
      : rawSourceFile
        ? {
            sourceFile: rawSourceFile,
            sourcePathStatus: "outside-connected-root" as const,
          }
        : {}),
    ...(Number.isInteger(anchor.line) && (anchor.line ?? 0) > 0
      ? { line: anchor.line }
      : {}),
    ...(Number.isInteger(anchor.column) && (anchor.column ?? 0) > 0
      ? { column: anchor.column }
      : {}),
    ...(anchor.method ? { method: anchor.method } : {}),
    ...(bounded(anchor.component, MAX_COMPONENT_LENGTH)
      ? { component: bounded(anchor.component, MAX_COMPONENT_LENGTH) }
      : {}),
    ...ownerAnchorFields(anchor),
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
  const leafRelPath = safeRelativePath(anchor.relPath);
  const leafSourceFile = safeRelativePath(anchor.sourceFile);
  const ownerRelPath = safeRelativePath(anchor.ownerRelPath);
  const ownerSourceFile = safeRelativePath(anchor.ownerSourceFile);
  const leafPath = leafRelPath ?? leafSourceFile;
  const ownerPath = ownerRelPath ?? ownerSourceFile;
  const useOwnerPath = !leafPath && Boolean(ownerPath);
  const canonicalPath = leafPath ?? ownerPath;
  const sourceFile =
    leafSourceFile ?? leafRelPath ?? ownerSourceFile ?? ownerRelPath;
  const line = useOwnerPath ? anchor.ownerLine : anchor.line;
  const column = useOwnerPath ? anchor.ownerColumn : anchor.column;
  const method = useOwnerPath ? anchor.ownerMethod : anchor.method;
  const component = useOwnerPath
    ? (anchor.ownerComponent ?? anchor.component)
    : anchor.component;
  if (!canonicalPath) {
    if (
      anchor.relPath ||
      anchor.sourceFile ||
      anchor.ownerRelPath ||
      anchor.ownerSourceFile
    ) {
      return anchorFailure(
        "unsafe-source-path",
        `Source anchor ${index + 1} has neither a safe project-relative leaf path nor an app-authored owner path.`,
      );
    }
    return anchorFailure(
      "missing-source-provenance",
      `Source anchor ${index + 1} is missing file provenance.`,
    );
  }
  if (
    !Number.isInteger(line) ||
    !Number.isInteger(column) ||
    (line ?? 0) < 1 ||
    (column ?? 0) < 1
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
    sourceFile: sourceFile ?? canonicalPath,
    line: line!,
    column: column!,
    positionPrecision: sourcePositionPrecision(method),
    ...(method ? { method } : {}),
    ...(bounded(component, MAX_COMPONENT_LENGTH)
      ? { component: bounded(component, MAX_COMPONENT_LENGTH) }
      : {}),
    ...ownerAnchorFields(anchor),
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
    (input.operation !== "insert" && subjectAnchorIds.length === 0) ||
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
          input.runtimeRelationship.sourceScreenId,
          MAX_SCREEN_ID_LENGTH,
        )
          ? {
              sourceScreenId: bounded(
                input.runtimeRelationship.sourceScreenId,
                MAX_SCREEN_ID_LENGTH,
              ),
            }
          : {}),
        ...(bounded(
          input.runtimeRelationship.targetScreenId,
          MAX_SCREEN_ID_LENGTH,
        )
          ? {
              targetScreenId: bounded(
                input.runtimeRelationship.targetScreenId,
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
        ...(sourceAnchors.some(
          (anchor) =>
            anchor.positionPrecision !== "authored" ||
            (anchor.ownerPositionPrecision !== undefined &&
              anchor.ownerPositionPrecision !== "authored"),
        )
          ? [
              `Do not trust line/column on any anchor whose positionPrecision is not "authored", nor ownerLine/ownerColumn whose ownerPositionPrecision is not "authored" — the two tiers are reported separately and can differ on the same anchor. A "transformed" position is the dev server's own output coordinates (React 19 exposes only an owner stack), and an "unknown" one never reported its tier; on those, treat the file and component as the reliable part and locate the element by its JSX shape, then re-derive the real line from the file you read.`,
            ]
          : []),
        "Use semantic source edits; do not apply a generic AST reparent, group, or wrapper transform.",
        "Obtain human write consent and write through the local bridge with expectedVersionHash from the corresponding read and requireExpectedVersionHash: true.",
        "If a version hash conflicts, re-read the source and re-plan instead of overwriting it.",
        "Keep the live preview pending until HMR renders and confirms the intended runtime relationship.",
        ...(sourceAnchors.some(
          (anchor) => anchor.ownerKey || anchor.ownerRelPath,
        )
          ? [
              "An anchor's ownerRelPath/ownerLine is where the enclosing component was INSTANTIATED — for a mapped instance, the `.map()` call site — while relPath/line is the element's own JSX inside that component; edit whichever one the change actually belongs to. ownerKey is the React key of the selected instance, not a third location: its siblings share that one call site, so decide whether the change belongs to the data behind that key or to every instance rendered from it.",
            ]
          : []),
      ],
    },
  };
}

export function buildRuntimeReactStructureMoveHandoff(
  input: BuildRuntimeReactStructureMoveHandoffInput,
): ReactSemanticHandoffBuildResult {
  const sourceScreenId = bounded(input.sourceScreenId, MAX_SCREEN_ID_LENGTH);
  const targetScreenId = bounded(input.targetScreenId, MAX_SCREEN_ID_LENGTH);
  if (!sourceScreenId || !targetScreenId) {
    return anchorFailure(
      "invalid-runtime-relationship",
      "Cross-screen runtime structure moves require exact source and target screen ids.",
    );
  }
  const subjectAnchor = { ...input.subjectAnchor, id: "subject" };
  const targetAnchor = { ...input.targetAnchor, id: "target" };
  const operation = input.placement === "inside" ? "reparent" : "move";
  return buildReactSemanticHandoff({
    operation,
    desiredChange:
      input.placement === "inside"
        ? `Move the runtime React subject from screen "${sourceScreenId}" inside the target anchor in screen "${targetScreenId}" while preserving the intended visual order and behavior.`
        : `Move the runtime React subject from screen "${sourceScreenId}" ${input.placement} the target anchor in screen "${targetScreenId}" while preserving the intended visual order and behavior.`,
    sourceAnchors: [subjectAnchor, targetAnchor],
    runtimeRelationship: {
      kind: input.placement,
      subjectAnchorIds: ["subject"],
      targetAnchorId: "target",
      screenId: targetScreenId,
      sourceScreenId,
      targetScreenId,
      description: `Runtime React ${operation} from screen "${sourceScreenId}" to screen "${targetScreenId}" with placement "${input.placement}". Verify both source anchors and their surrounding control flow before editing either file.`,
    },
    versionHashes: [],
  });
}

export function buildRuntimeReactLayerStateHandoff(
  input: BuildRuntimeReactLayerStateHandoffInput,
): ReactSemanticHandoffBuildResult {
  const screenId = bounded(input.screenId, MAX_SCREEN_ID_LENGTH);
  if (!screenId) {
    return anchorFailure(
      "invalid-runtime-relationship",
      "Runtime layer state changes require an exact owning screen id.",
    );
  }

  const attributeName = `data-agent-native-${input.state}`;
  const subjectAnchor = { ...input.subjectAnchor, id: "subject" };
  const desiredChange = input.enabled
    ? `Set ${attributeName}="true" on the JSX host element for this runtime layer. Keep it as durable source metadata; do not replace it with a transient DOM mutation, CSS-only workaround, or wrapper.`
    : `Remove the ${attributeName} attribute from the JSX host element for this runtime layer. Do not replace it with a transient DOM mutation, CSS-only workaround, or wrapper.`;

  return buildReactSemanticHandoff({
    operation: "set-layer-state",
    desiredChange,
    sourceAnchors: [subjectAnchor],
    runtimeRelationship: {
      kind: "metadata",
      subjectAnchorIds: ["subject"],
      screenId,
      sourceScreenId: screenId,
      targetScreenId: screenId,
      description: `${input.enabled ? "Set" : "Clear"} runtime React layer state "${input.state}" using the durable ${attributeName} JSX attribute in screen "${screenId}".`,
    },
    versionHashes: [],
  });
}
