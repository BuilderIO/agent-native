import type { ScrubRelativeExpression } from "@agent-native/toolkit/design-tweaks";
import { removeBreakpointMediaDeclaration } from "@shared/breakpoint-media";
import {
  applyOrdinaryVisualStyleBatch,
  applyVisualEdit,
  type ApplyVisualEditResult,
  type CodeLayerSource,
  type VisualStyleBatchResult,
} from "@shared/code-layer";
import {
  duplicateStatePreviewRules,
  type InteractionState,
  upsertResponsiveStateStyles,
  upsertStateStyles,
} from "@shared/interaction-states";
import {
  normalizeCssPropertyName,
  planBreakpointStyleWrite,
  utilityStem,
} from "@shared/responsive-classes";
import {
  type ElementProvenanceUnavailableReason,
  isRunningAppSourceType,
  normalizeDesignSourceType,
  type DesignSourceType,
} from "@shared/source-mode";
import { isVectorEndpointProperty } from "@shared/vector-endpoints";

import type { RelativeStyleOperation } from "@/components/design/edit-panel/style-change-types";
import type { ElementInfo } from "@/components/design/types";

import {
  buildReactSemanticHandoff,
  buildRuntimeReactLayerStateHandoff,
  redactReactSourceAnchor,
  type ReactSourceAnchor,
  type ReactSourceScope,
} from "./react-semantic-handoff";
import { camelStyleProperty } from "./style-utils";

export interface RuntimeStructureNodeSignature {
  tag: string;
  text: string;
  classes: string[];
  component?: string;
}

export type PendingRelativeStyleOperation = RelativeStyleOperation;

export function relativeOperationsForStyles(
  styles: Record<string, string>,
  metadata: {
    relativeDelta?: number;
    relativeExpression?: ScrubRelativeExpression;
    relativeDeltaProperties?: string[];
  } = {},
): Record<string, PendingRelativeStyleOperation> | undefined {
  const requestedProperties =
    metadata.relativeDeltaProperties ??
    (Object.keys(styles).length === 1 ? [Object.keys(styles)[0]!] : []);
  const properties = requestedProperties.filter((property) =>
    Object.prototype.hasOwnProperty.call(styles, property),
  );
  if (properties.length === 0) return undefined;
  const expression = metadata.relativeExpression;
  if (expression) {
    return Object.fromEntries(
      properties.map((property) => [
        property,
        { kind: "expression" as const, ...expression },
      ]),
    );
  }
  const delta = metadata.relativeDelta;
  if (typeof delta === "number") {
    return Object.fromEntries(
      properties.map((property) => [
        property,
        { kind: "delta" as const, delta },
      ]),
    );
  }
  return undefined;
}

export function normalizeRuntimeStructureClasses(
  values: readonly string[],
): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  ).sort();
}

export function normalizeRuntimeStructureText(
  value: string | null | undefined,
): string {
  return value?.replace(/\s+/g, " ").trim().slice(0, 120) ?? "";
}

export function runtimeStructureNodeSignature(args: {
  info?: Pick<
    ElementInfo,
    "tagName" | "textContent" | "classes" | "componentName"
  > | null;
  sourceAnchor?: ReactSourceAnchor;
}): RuntimeStructureNodeSignature | undefined {
  if (!args.info?.tagName) return undefined;
  const component =
    args.sourceAnchor?.component?.trim() || args.info.componentName?.trim();
  return {
    tag: args.info.tagName.trim().toLowerCase(),
    text: normalizeRuntimeStructureText(args.info.textContent),
    classes: normalizeRuntimeStructureClasses(args.info.classes),
    ...(component ? { component } : {}),
  };
}

export interface PendingVisualStyleEdit {
  screenId: string;
  routePath?: string;
  filename: string;
  screenName: string;
  selector: string;
  sourceId?: string | null;
  runtimeSelector?: string | null;
  runtimeSourceId?: string | null;
  sourceAnchor?: ReactSourceAnchor;
  tagName?: string | null;
  classes: string[];
  styles: Record<string, string>;
  relativeOperations?: Record<string, PendingRelativeStyleOperation>;
  interactionState?: InteractionState;
  baseStyles?: Record<string, string>;
  originalStyles: Record<string, string>;
  updatedAt: number;
  /**
   * §6.4 — breakpoint scope active when the edit was made. When present the
   * edit must be applied as a width-scoped override (apply-visual-edit with
   * `activeFrameWidthPx`), not a base write. `upperBoundPx` is the Framer
   * cascade bound (just below the next-wider frame); null means the active
   * frame was the widest context (base edit).
   */
  breakpoint?: {
    activeWidthPx: number;
    upperBoundPx: number | null;
    editScope?: "cascade-smaller" | "only";
  };
}

let lastPendingLiveEditTimestamp = 0;

export function nextPendingLiveEditTimestamp(now = Date.now()): number {
  lastPendingLiveEditTimestamp = Math.max(
    lastPendingLiveEditTimestamp + 1,
    now,
  );
  return lastPendingLiveEditTimestamp;
}

function pendingLiveEditSubjectKey(edit: PendingLiveNonStyleEdit): string {
  return `${edit.screenId}:${edit.routePath ?? ""}:${edit.sourceId?.trim() || edit.selector.trim()}`;
}

export function mergePendingLiveNonStyleEdits(
  edits: readonly PendingLiveNonStyleEdit[],
): PendingLiveNonStyleEdit[] {
  const merged: PendingLiveNonStyleEdit[] = [];
  for (const edit of edits) {
    if (edit.kind === "structure") {
      const supersededInsertIndex = edit.removed
        ? merged.findIndex(
            (candidate) =>
              candidate.kind === "structure" &&
              Boolean(candidate.insertedHtml) &&
              pendingLiveEditSubjectKey(candidate) ===
                pendingLiveEditSubjectKey(edit),
          )
        : -1;
      if (supersededInsertIndex !== -1) {
        merged.splice(supersededInsertIndex, 1);
        continue;
      }
      if (edit.transactionId) {
        const transactionIndex = merged.findIndex(
          (candidate) =>
            candidate.kind === "structure" &&
            candidate.transactionId === edit.transactionId,
        );
        if (transactionIndex !== -1) {
          const previous = merged[transactionIndex] as PendingLiveStructureEdit;
          merged[transactionIndex] = {
            ...edit,
            groupedEdits: [
              ...(previous.groupedEdits ?? [previous]),
              ...(edit.groupedEdits ?? [edit]),
            ],
          };
          continue;
        }
      }
      merged.push(edit);
      continue;
    }
    if (edit.kind === "layer-state") {
      const nextKey = `${pendingLiveEditSubjectKey(edit)}:${edit.state}`;
      const index = merged.findIndex(
        (candidate) =>
          candidate.kind === "layer-state" &&
          `${pendingLiveEditSubjectKey(candidate)}:${candidate.state}` ===
            nextKey,
      );
      if (index === -1) {
        merged.push(edit);
        continue;
      }
      const previous = merged[index] as PendingLiveLayerStateEdit;
      if (previous.originalEnabled === edit.enabled) {
        merged.splice(index, 1);
        continue;
      }
      merged[index] = {
        ...previous,
        ...edit,
        originalEnabled: previous.originalEnabled,
      };
      continue;
    }
    if (edit.kind === "layer-name") {
      const index = merged.findIndex(
        (candidate) =>
          candidate.kind === "layer-name" &&
          pendingLiveEditSubjectKey(candidate) ===
            pendingLiveEditSubjectKey(edit),
      );
      if (index === -1) {
        merged.push(edit);
        continue;
      }
      const previous = merged[index] as PendingLiveLayerNameEdit;
      if (previous.originalName === edit.name) {
        merged.splice(index, 1);
        continue;
      }
      merged[index] = {
        ...previous,
        ...edit,
        originalName: previous.originalName,
      };
      continue;
    }
    const nextKey = pendingLiveEditSubjectKey(edit);
    const index = merged.findIndex(
      (candidate) =>
        candidate.kind === "text" &&
        pendingLiveEditSubjectKey(candidate) === nextKey,
    );
    if (index === -1) {
      merged.push(edit);
      continue;
    }
    const previous = merged[index] as PendingLiveTextEdit;
    const relativeOperations = {
      ...previous.relativeOperations,
      ...edit.relativeOperations,
    };
    merged[index] = {
      ...previous,
      ...edit,
      ...(Object.keys(relativeOperations).length > 0
        ? { relativeOperations }
        : {}),
      originalValue: previous.originalValue,
      ...(previous.originalHtml !== undefined
        ? { originalHtml: previous.originalHtml }
        : {}),
    };
  }
  return merged;
}

export function mergePendingLiveNonStyleEdit(
  edits: readonly PendingLiveNonStyleEdit[],
  nextEdit: PendingLiveNonStyleEdit,
): PendingLiveNonStyleEdit[] {
  return mergePendingLiveNonStyleEdits([...edits, nextEdit]);
}

export function pendingLiveTextUndoRevertValue(
  currentEdits: readonly PendingLiveNonStyleEdit[],
  nextEdit: PendingLiveTextEdit,
): { value: string; html?: string } {
  const currentForTarget = currentEdits.find(
    (edit): edit is PendingLiveTextEdit =>
      edit.kind === "text" &&
      pendingLiveEditSubjectKey(edit) === pendingLiveEditSubjectKey(nextEdit),
  );
  return currentForTarget
    ? { value: currentForTarget.value, html: currentForTarget.html }
    : { value: nextEdit.originalValue, html: nextEdit.originalHtml };
}

export interface PendingLiveTextEdit {
  kind: "text";
  screenId: string;
  routePath?: string;
  filename: string;
  screenName: string;
  selector: string;
  sourceId?: string | null;
  sourceAnchor?: ReactSourceAnchor;
  tagName?: string | null;
  classes: string[];
  value: string;
  html?: string;
  relativeOperations?: Record<string, PendingRelativeStyleOperation>;
  originalValue: string;
  originalHtml?: string;
  updatedAt: number;
}

export interface PendingLiveLayerStateEdit {
  kind: "layer-state";
  screenId: string;
  routePath?: string;
  filename: string;
  screenName: string;
  layerId: string;
  selector: string;
  sourceId?: string | null;
  sourceAnchor?: ReactSourceAnchor;
  tagName?: string | null;
  classes: string[];
  state: "hidden" | "locked";
  enabled: boolean;
  originalEnabled: boolean;
  updatedAt: number;
}

export interface PendingLiveLayerNameEdit {
  kind: "layer-name";
  screenId: string;
  routePath?: string;
  filename: string;
  screenName: string;
  layerId: string;
  selector: string;
  sourceId?: string | null;
  sourceAnchor?: ReactSourceAnchor;
  tagName?: string | null;
  classes: string[];
  name: string;
  originalName: string;
  updatedAt: number;
}

export function pendingLiveLayerStateUndoRevertValue(
  currentEdits: readonly PendingLiveNonStyleEdit[],
  nextEdit: PendingLiveLayerStateEdit,
): boolean {
  const currentForTarget = currentEdits.find(
    (edit): edit is PendingLiveLayerStateEdit =>
      edit.kind === "layer-state" &&
      edit.state === nextEdit.state &&
      pendingLiveEditSubjectKey(edit) === pendingLiveEditSubjectKey(nextEdit),
  );
  return currentForTarget?.enabled ?? nextEdit.originalEnabled;
}

export function pendingLiveLayerNameUndoRevertValue(
  currentEdits: readonly PendingLiveNonStyleEdit[],
  nextEdit: PendingLiveLayerNameEdit,
): string {
  const currentForTarget = currentEdits.find(
    (edit): edit is PendingLiveLayerNameEdit =>
      edit.kind === "layer-name" &&
      pendingLiveEditSubjectKey(edit) === pendingLiveEditSubjectKey(nextEdit),
  );
  return currentForTarget?.name ?? nextEdit.originalName;
}

export function shouldRedoPendingLiveNonStyleBeforeStyle(
  styleEntry: { edit: { updatedAt: number } } | undefined,
  nonStyleEntry: { edit: { updatedAt: number } } | undefined,
): boolean {
  return Boolean(
    nonStyleEntry &&
    (!styleEntry || nonStyleEntry.edit.updatedAt < styleEntry.edit.updatedAt),
  );
}

export interface PendingLiveStructureEdit {
  kind: "structure";
  screenId: string;
  routePath?: string;
  filename: string;
  screenName: string;
  selector: string;
  sourceId?: string | null;
  sourceAnchor?: ReactSourceAnchor;
  subjectSignature?: RuntimeStructureNodeSignature;
  anchorSelector: string;
  anchorSourceId?: string | null;
  anchorSourceAnchor?: ReactSourceAnchor;
  anchorSignature?: RuntimeStructureNodeSignature;
  routeSourceFile?: string;
  placement: "before" | "after" | "inside";
  dropMode?: "flow-insert" | "absolute-container";
  forceFlowPositionOverride?: boolean;
  sourceRect?: { x: number; y: number; width: number; height: number };
  anchorRect?: { x: number; y: number; width: number; height: number };
  gridPlacement?: {
    column: number;
    columnEnd: number;
    row: number;
    rowEnd: number;
  };
  gridDisplacements?: Array<{
    sourceId?: string;
    selector?: string;
    placement: {
      column: number;
      columnEnd: number;
      row: number;
      rowEnd: number;
    };
  }>;
  insertedHtml?: string;
  remintCollidingNodeIds?: boolean;
  replaced?: true;
  replacementSelector?: string;
  replacementSourceId?: string | null;
  replacementSignature?: RuntimeStructureNodeSignature;
  replacementSnapshotSignature?: string;
  removed?: true;
  requestId?: string;
  transactionId?: string;
  groupedEdits?: PendingLiveStructureEdit[];
  updatedAt: number;
}

interface NormalizedResolvablePath {
  value: string;
  absolute: boolean;
  caseInsensitive: boolean;
}

function normalizeResolvablePath(
  rawValue: string | undefined,
): NormalizedResolvablePath | undefined {
  const raw = rawValue?.trim().replace(/\\/g, "/");
  if (!raw || raw.includes("\0")) return undefined;

  let prefix = "";
  let remainder = raw;
  let absolute = false;
  let caseInsensitive = false;
  const drive = raw.match(/^([a-z]):(\/.*)?$/i);
  if (drive) {
    if (!drive[2]?.startsWith("/")) return undefined;
    prefix = `${drive[1]!.toUpperCase()}:/`;
    remainder = drive[2].slice(1);
    absolute = true;
    caseInsensitive = true;
  } else if (raw.startsWith("//")) {
    const [server, share, ...rest] = raw.slice(2).split("/");
    if (!server || !share) return undefined;
    prefix = `//${server}/${share}`;
    remainder = rest.join("/");
    absolute = true;
    caseInsensitive = true;
  } else if (raw.startsWith("/")) {
    prefix = "/";
    remainder = raw.slice(1);
    absolute = true;
  } else if (/^[a-z]+:/i.test(raw)) {
    return undefined;
  }

  const segments: string[] = [];
  for (const segment of remainder.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0) {
        segments.pop();
      } else if (!absolute) {
        return undefined;
      }
      continue;
    }
    segments.push(segment);
  }

  const suffix = segments.join("/");
  const value = absolute
    ? prefix.endsWith("/")
      ? `${prefix}${suffix}`
      : suffix
        ? `${prefix}/${suffix}`
        : prefix
    : suffix;
  if (!value) return undefined;
  return { value, absolute, caseInsensitive };
}

function sourcePathRelativeToRoot(args: {
  sourceFile: string;
  rootPath?: string;
}): string | undefined {
  const source = normalizeResolvablePath(args.sourceFile);
  if (!source) return undefined;
  if (!source.absolute) return source.value;

  const root = normalizeResolvablePath(args.rootPath);
  if (!root?.absolute || root.caseInsensitive !== source.caseInsensitive) {
    return undefined;
  }
  const comparableSource = source.caseInsensitive
    ? source.value.toLowerCase()
    : source.value;
  const comparableRoot = root.caseInsensitive
    ? root.value.toLowerCase()
    : root.value;
  const rootPrefix = comparableRoot.endsWith("/")
    ? comparableRoot
    : `${comparableRoot}/`;
  if (!comparableSource.startsWith(rootPrefix)) return undefined;
  const relative = source.value.slice(rootPrefix.length);
  return normalizeResolvablePath(relative)?.value;
}

export function projectRelativeSourcePath(args: {
  sourceFile?: string;
  rootPath?: string;
}): string | undefined {
  const sourceFile = args.sourceFile?.trim();
  if (!sourceFile) return undefined;
  return sourcePathRelativeToRoot({
    sourceFile,
    rootPath: args.rootPath,
  });
}

export function reactSourceAnchorForPendingEdit(args: {
  info?: Pick<ElementInfo, "provenance" | "sourceId" | "selector"> | null;
  id?: string;
  runtimeMultiplicity?: number;
  scope?: ReactSourceScope;
  reason?: string;
  rootPath?: string;
}): ReactSourceAnchor | undefined {
  const provenance = args.info?.provenance;
  const sourceFile = provenance?.sourceFile?.trim();
  if (!sourceFile || !provenance?.line || !provenance.column) return undefined;
  const runtimeMultiplicity =
    Number.isInteger(args.runtimeMultiplicity) &&
    (args.runtimeMultiplicity ?? 0) > 0
      ? args.runtimeMultiplicity!
      : 1;
  const relPath = sourcePathRelativeToRoot({
    sourceFile,
    rootPath: args.rootPath,
  });
  const ownerSourceFile = provenance.ownerSourceFile?.trim();
  const ownerRelPath = ownerSourceFile
    ? sourcePathRelativeToRoot({
        sourceFile: ownerSourceFile,
        rootPath: args.rootPath,
      })
    : undefined;
  return {
    id:
      args.id?.trim() ||
      args.info?.sourceId?.trim() ||
      args.info?.selector?.trim() ||
      undefined,
    sourceFile,
    ...(relPath ? { relPath } : {}),
    line: provenance.line,
    column: provenance.column,
    ...(provenance.method ? { method: provenance.method } : {}),
    component: provenance.component,
    ...(ownerSourceFile ? { ownerSourceFile } : {}),
    ...(ownerRelPath ? { ownerRelPath } : {}),
    ...(provenance.ownerLine ? { ownerLine: provenance.ownerLine } : {}),
    ...(provenance.ownerColumn ? { ownerColumn: provenance.ownerColumn } : {}),
    ...(provenance.ownerComponentName
      ? { ownerComponent: provenance.ownerComponentName }
      : {}),
    ...(provenance.ownerMethod ? { ownerMethod: provenance.ownerMethod } : {}),
    ...(provenance.ownerKey ? { ownerKey: provenance.ownerKey } : {}),
    runtimeMultiplicity,
    ...(args.reason?.trim() ? { reason: args.reason.trim() } : {}),
    scope:
      args.scope ?? (runtimeMultiplicity > 1 ? "repeated-render" : "unknown"),
  };
}

export function reactSourceAnchorUnavailableReason(
  infos: ReadonlyArray<Pick<ElementInfo, "provenance"> | null | undefined>,
): ElementProvenanceUnavailableReason | undefined {
  for (const info of infos) {
    const provenance = info?.provenance;
    if (provenance?.sourceFile) continue;
    if (provenance?.unavailableReason) return provenance.unavailableReason;
  }
  return undefined;
}

export type PendingLiveNonStyleEdit =
  | PendingLiveTextEdit
  | PendingLiveLayerStateEdit
  | PendingLiveLayerNameEdit
  | PendingLiveStructureEdit;
export type PendingVisualStyleUndoTarget = {
  edit: PendingVisualStyleEdit;
  revertStyles: Record<string, string>;
};
export type PendingVisualStyleUndoEntry = PendingVisualStyleUndoTarget & {
  gestureId?: string;
  groupedTargets?: PendingVisualStyleUndoTarget[];
};
export interface PendingVisualStyleGestureState {
  sequence: number;
  activeId: string | null;
}

export function pendingVisualStyleGestureIdForPhase(
  state: PendingVisualStyleGestureState,
  phase: "preview" | "commit" | "cancel" | undefined,
  enabled: boolean,
): string | undefined {
  if (phase === "cancel") {
    state.activeId = null;
    return undefined;
  }
  if (phase === "commit" && !enabled) {
    state.activeId = null;
    return undefined;
  }
  if (!enabled) return undefined;
  const nextId = () => {
    state.sequence += 1;
    return `pending-live-style-${state.sequence}`;
  };
  if (phase === "preview") {
    state.activeId ??= nextId();
    return state.activeId;
  }
  if (phase === "commit") {
    const gestureId = state.activeId ?? nextId();
    state.activeId = null;
    return gestureId;
  }
  return nextId();
}
export type PendingLiveTextUndoEntry = {
  kind: "text";
  edit: PendingLiveTextEdit;
  revertValue: string;
  revertHtml?: string;
};
export type PendingLiveStructureUndoEntry = {
  kind: "structure";
  edit: PendingLiveStructureEdit;
  groupedEdits?: PendingLiveStructureEdit[];
};
export type PendingLiveLayerStateUndoEntry = {
  kind: "layer-state";
  edit: PendingLiveLayerStateEdit;
  revertEnabled: boolean;
};
export type PendingLiveLayerNameUndoEntry = {
  kind: "layer-name";
  edit: PendingLiveLayerNameEdit;
  revertName: string;
};
export type PendingLiveNonStyleUndoEntry =
  | PendingLiveTextUndoEntry
  | PendingLiveLayerStateUndoEntry
  | PendingLiveLayerNameUndoEntry
  | PendingLiveStructureUndoEntry;

export function appendPendingVisualStyleUndoEntry(
  stack: PendingVisualStyleUndoEntry[],
  entry: PendingVisualStyleUndoEntry,
): void {
  const last = stack[stack.length - 1];
  if (
    entry.gestureId &&
    last?.gestureId === entry.gestureId &&
    pendingVisualStylePropertyKey(last.edit) ===
      pendingVisualStylePropertyKey(entry.edit)
  ) {
    const targets = pendingVisualStyleUndoTargets(last);
    const index = targets.findIndex(
      (target) =>
        pendingVisualStyleEditKey(target.edit) ===
        pendingVisualStyleEditKey(entry.edit),
    );
    if (index === -1) {
      last.groupedTargets = [
        ...(last.groupedTargets ?? []),
        { edit: entry.edit, revertStyles: entry.revertStyles },
      ];
    } else {
      const previous = targets[index]!;
      const nextTarget = {
        edit: {
          ...entry.edit,
          styles: { ...previous.edit.styles, ...entry.edit.styles },
          originalStyles: {
            ...entry.edit.originalStyles,
            ...previous.edit.originalStyles,
          },
        },
        revertStyles: { ...entry.revertStyles, ...previous.revertStyles },
      };
      if (index === 0) {
        last.edit = nextTarget.edit;
        last.revertStyles = nextTarget.revertStyles;
      } else {
        last.groupedTargets![index - 1] = nextTarget;
      }
    }
    last.edit = { ...last.edit, updatedAt: entry.edit.updatedAt };
    return;
  }
  stack.push(entry);
}

export function pendingVisualStyleUndoTargets(
  entry: PendingVisualStyleUndoEntry,
): PendingVisualStyleUndoTarget[] {
  return [
    { edit: entry.edit, revertStyles: entry.revertStyles },
    ...(entry.groupedTargets ?? []),
  ];
}

export function pendingVisualStyleEditsFromUndoStack(
  stack: readonly PendingVisualStyleUndoEntry[],
): PendingVisualStyleEdit[] {
  return stack.flatMap((entry) =>
    pendingVisualStyleUndoTargets(entry).map((target) => target.edit),
  );
}

export function appendPendingLiveNonStyleUndoEntry(
  stack: PendingLiveNonStyleUndoEntry[],
  entry: PendingLiveNonStyleUndoEntry,
  coalesceAdjacent = true,
): void {
  const last = stack[stack.length - 1];
  if (
    coalesceAdjacent &&
    last?.kind === "text" &&
    entry.kind === "text" &&
    pendingLiveEditSubjectKey(last.edit) ===
      pendingLiveEditSubjectKey(entry.edit)
  ) {
    last.edit = entry.edit;
    return;
  }
  if (
    last?.kind === "structure" &&
    entry.kind === "structure" &&
    entry.edit.transactionId &&
    last.edit.transactionId === entry.edit.transactionId
  ) {
    last.groupedEdits = [
      ...(last.groupedEdits ?? [last.edit]),
      ...pendingLiveStructureEditsFromUndoEntry(entry),
    ];
    last.edit = entry.edit;
    return;
  }
  if (
    coalesceAdjacent &&
    last?.kind === "layer-name" &&
    entry.kind === "layer-name" &&
    pendingLiveEditSubjectKey(last.edit) ===
      pendingLiveEditSubjectKey(entry.edit)
  ) {
    last.edit = entry.edit;
    return;
  }
  stack.push(entry);
}

export function pendingLiveStructureEditsFromUndoEntry(
  entry: PendingLiveStructureUndoEntry,
): PendingLiveStructureEdit[] {
  return entry.groupedEdits ?? pendingLiveStructureEditsFromEdit(entry.edit);
}

export function pendingLiveStructureRedoSourceEdit(
  entry: PendingLiveStructureUndoEntry,
): PendingLiveStructureEdit {
  const edits = pendingLiveStructureEditsFromUndoEntry(entry);
  return edits.length > 1 ? { ...entry.edit, groupedEdits: edits } : entry.edit;
}

export function pendingLiveStructureEditsFromEdit(
  edit: PendingLiveStructureEdit,
): PendingLiveStructureEdit[] {
  return edit.groupedEdits ?? [edit];
}

export function pendingLiveNonStyleEditsFromUndoStack(
  stack: readonly PendingLiveNonStyleUndoEntry[],
): PendingLiveNonStyleEdit[] {
  const edits: PendingLiveNonStyleEdit[] = [];
  for (const entry of stack) {
    if (entry.kind === "structure") {
      edits.push(...pendingLiveStructureEditsFromUndoEntry(entry));
    } else {
      edits.push(entry.edit);
    }
  }
  return edits;
}

export function pendingStructureEditSourcePaths(
  edit: PendingLiveStructureEdit,
): string[] | null {
  const required = pendingLiveStructureEditsFromEdit(edit).flatMap((member) => [
    ...(member.insertedHtml && !member.replaced
      ? []
      : [member.sourceAnchor?.relPath ?? member.sourceAnchor?.ownerRelPath]),
    ...(member.removed || member.replaced
      ? []
      : [
          member.anchorSourceAnchor?.relPath ??
            member.anchorSourceAnchor?.ownerRelPath ??
            (member.insertedHtml ? member.routeSourceFile : undefined),
        ]),
  ]);
  if (required.some((path) => !path)) return null;
  return required as string[];
}

export type PendingStructureRedoCommand =
  | { kind: "delete" }
  | {
      kind: "insert";
      html: string;
      replaceAnchor?: boolean;
      remintCollidingNodeIds?: boolean;
    }
  | { kind: "move" };

export function pendingStructureRedoCommand(
  edit: PendingLiveStructureEdit,
): PendingStructureRedoCommand {
  const insertedEdit = [edit, ...(edit.groupedEdits ?? [])].find(
    (candidate) => candidate.insertedHtml,
  );
  if (!insertedEdit && edit.removed) return { kind: "delete" };
  return insertedEdit?.insertedHtml
    ? {
        kind: "insert",
        html: insertedEdit.insertedHtml,
        ...(insertedEdit.replaced ? { replaceAnchor: true } : {}),
        ...(insertedEdit.remintCollidingNodeIds
          ? { remintCollidingNodeIds: true }
          : {}),
      }
    : { kind: "move" };
}

export function pendingLiveStructureEditsMatch(
  left: PendingLiveStructureEdit,
  right: PendingLiveStructureEdit,
): boolean {
  return (
    left.screenId === right.screenId &&
    left.selector === right.selector &&
    (left.sourceId ?? "") === (right.sourceId ?? "") &&
    left.anchorSelector === right.anchorSelector &&
    (left.anchorSourceId ?? "") === (right.anchorSourceId ?? "") &&
    left.placement === right.placement &&
    Boolean(left.removed) === Boolean(right.removed) &&
    Boolean(left.replaced) === Boolean(right.replaced) &&
    left.dropMode === right.dropMode &&
    Boolean(left.forceFlowPositionOverride) ===
      Boolean(right.forceFlowPositionOverride)
  );
}

function pendingVisualStyleEditKey(edit: PendingVisualStyleEdit): string {
  return [
    edit.screenId,
    edit.routePath ?? "",
    edit.sourceId?.trim() || edit.selector.trim() || "unknown",
    edit.interactionState ?? "default",
  ].join("::");
}

function pendingVisualStylePropertyKey(edit: PendingVisualStyleEdit): string {
  return Object.keys(edit.styles).sort().join("::");
}

export function mergePendingVisualStyleEdit(
  edits: readonly PendingVisualStyleEdit[],
  nextEdit: PendingVisualStyleEdit,
): PendingVisualStyleEdit[] {
  const nextKey = pendingVisualStyleEditKey(nextEdit);
  let merged = false;
  const next = edits.map((edit) => {
    if (pendingVisualStyleEditKey(edit) !== nextKey) return edit;
    merged = true;
    return {
      ...edit,
      ...nextEdit,
      classes: nextEdit.classes.length > 0 ? nextEdit.classes : edit.classes,
      styles: { ...edit.styles, ...nextEdit.styles },
      relativeOperations: mergeRelativeStyleOperations(edit, nextEdit),
      originalStyles: {
        ...nextEdit.originalStyles,
        ...edit.originalStyles,
      },
      baseStyles: edit.baseStyles ?? nextEdit.baseStyles,
    };
  });
  return merged ? next : [...edits, nextEdit];
}

function mergeRelativeStyleOperations(
  current: PendingVisualStyleEdit,
  next: PendingVisualStyleEdit,
): PendingVisualStyleEdit["relativeOperations"] {
  const operations = { ...current.relativeOperations };
  for (const property of Object.keys(next.styles)) delete operations[property];
  Object.assign(operations, next.relativeOperations);
  return Object.keys(operations).length > 0 ? operations : undefined;
}

export function mergePendingVisualStyleEdits(
  edits: readonly PendingVisualStyleEdit[],
): PendingVisualStyleEdit[] {
  return edits.reduce<PendingVisualStyleEdit[]>(
    (merged, edit) => mergePendingVisualStyleEdit(merged, edit),
    [],
  );
}

export function pendingVisualStyleUndoRevertStyles(
  currentEdits: readonly PendingVisualStyleEdit[],
  nextEdit: PendingVisualStyleEdit,
): Record<string, string> {
  const currentForTarget = currentEdits.find(
    (edit) =>
      pendingVisualStyleEditKey(edit) === pendingVisualStyleEditKey(nextEdit),
  );
  return Object.fromEntries(
    Object.keys(nextEdit.styles).map((property) => [
      property,
      currentForTarget?.styles[property] ??
        nextEdit.originalStyles[property] ??
        "",
    ]),
  );
}

function styleLookup(
  styles: Record<string, string> | undefined,
  property: string,
): string | undefined {
  if (!styles) return undefined;
  const camel = camelStyleProperty(property);
  const kebab = property.replace(
    /[A-Z]/g,
    (match) => `-${match.toLowerCase()}`,
  );
  return styles[property] ?? styles[camel] ?? styles[kebab];
}

export function originalStylesForPendingVisualEdit(
  styles: Record<string, string>,
  primaryInfo?: Pick<ElementInfo, "computedStyles" | "inlineStyles"> | null,
  fallbackInfo?: Pick<ElementInfo, "computedStyles" | "inlineStyles"> | null,
): Record<string, string> {
  const sourceInfo = primaryInfo ?? fallbackInfo ?? null;
  const inlineStyles = sourceInfo?.inlineStyles;
  const computedStyles = sourceInfo?.computedStyles;
  return Object.fromEntries(
    Object.keys(styles).map((property) => {
      const inlineValue = styleLookup(inlineStyles, property);
      if (inlineValue !== undefined) return [property, inlineValue];
      if (inlineStyles) return [property, ""];
      return [property, styleLookup(computedStyles, property) ?? ""];
    }),
  );
}

export type PendingVisualStyleRevertPatch = PendingVisualStyleRuntimePatch & {
  interactionState?: InteractionState;
};

export function buildPendingVisualStyleRevertPatches(
  edits: readonly PendingVisualStyleEdit[],
): PendingVisualStyleRevertPatch[] {
  return edits
    .map((edit) => ({
      screenId: edit.screenId,
      routePath: edit.routePath,
      selector: edit.selector,
      sourceId: edit.sourceId,
      ...(edit.runtimeSelector
        ? { runtimeSelector: edit.runtimeSelector }
        : {}),
      ...(edit.runtimeSourceId
        ? { runtimeSourceId: edit.runtimeSourceId }
        : {}),
      styles: edit.originalStyles,
      ...(edit.interactionState
        ? { interactionState: edit.interactionState }
        : {}),
    }))
    .filter((patch) => Object.keys(patch.styles).length > 0);
}

export type PendingVisualStyleRuntimePatch = {
  screenId: string;
  routePath?: string;
  selector: string;
  sourceId?: string | null;
  runtimeSelector?: string | null;
  runtimeSourceId?: string | null;
  styles: Record<string, string>;
  interactionState?: InteractionState;
};

function nodeIdSelector(nodeId: string): string {
  return `[data-agent-native-node-id="${nodeId
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')}"]`;
}

export function runtimeStyleTarget(target: {
  selector: string;
  sourceId?: string | null;
  runtimeSelector?: string | null;
  runtimeSourceId?: string | null;
}): { selector: string; nodeId: string | null; selectorCandidates: string[] } {
  const selector = target.runtimeSelector?.trim() || target.selector;
  const nodeId = target.runtimeSourceId?.trim() || target.sourceId || null;
  return {
    selector,
    nodeId,
    selectorCandidates: [
      ...new Set(
        [
          selector,
          target.selector,
          nodeId ? nodeIdSelector(nodeId) : "",
          target.sourceId ? nodeIdSelector(target.sourceId) : "",
        ].filter(Boolean),
      ),
    ],
  };
}

export type SendPendingVisualStyleRuntimeProperty = (
  screenId: string,
  selector: string,
  property: string,
  value: string,
  options: {
    selectorCandidates: string[];
    nodeId?: string | null;
    routePath?: string;
    interactionState?: InteractionState;
  },
) => boolean;

export function pendingVisualStyleRouteMatches(
  patch: Pick<PendingVisualStyleRuntimePatch, "routePath">,
  currentRoutePath: string | null | undefined,
): boolean {
  return !patch.routePath || patch.routePath === currentRoutePath;
}

export function replayPendingVisualStyleRuntimePatch(
  patch: PendingVisualStyleRuntimePatch,
  sendProperty: SendPendingVisualStyleRuntimeProperty,
): boolean {
  const entries = Object.entries(patch.styles);
  if (entries.length === 0) return false;
  const target = runtimeStyleTarget(patch);
  if (target.selectorCandidates.length === 0) return false;
  return entries.every(([property, value]) =>
    sendProperty(patch.screenId, target.selector, property, value, {
      selectorCandidates: target.selectorCandidates,
      nodeId: target.nodeId,
      ...(patch.routePath ? { routePath: patch.routePath } : {}),
      ...(patch.interactionState
        ? { interactionState: patch.interactionState }
        : {}),
    }),
  );
}

export function getPendingVisualEditCount(
  edits: readonly PendingVisualStyleEdit[],
  liveEdits: readonly PendingLiveNonStyleEdit[] = [],
): number {
  return edits.length + liveEdits.length;
}

export function shouldBlockPendingVisualStyleNavigation(args: {
  hasPendingVisualStyleEdits: boolean;
  currentPathname: string;
  nextPathname: string;
}): boolean {
  return (
    args.hasPendingVisualStyleEdits &&
    args.currentPathname !== args.nextPathname
  );
}

const MAX_INSERTED_HTML_LENGTH = 4_000;

function boundedInsertedHtml(html: string): {
  value: string;
  truncated: boolean;
} {
  return html.length > MAX_INSERTED_HTML_LENGTH
    ? { value: html.slice(0, MAX_INSERTED_HTML_LENGTH), truncated: true }
    : { value: html, truncated: false };
}

export function formatPendingVisualStylePrompt(args: {
  designId?: string | null;
  designTitle?: string | null;
  activeFileId?: string | null;
  activeFilename?: string | null;
  localhostConnectionId?: string | null;
  edits: readonly PendingVisualStyleEdit[];
  liveEdits?: readonly PendingLiveNonStyleEdit[];
  audience?: "design-agent" | "coding-agent";
  screenRoutes?: Readonly<Record<string, string>>;
}): string {
  if (args.edits.length === 0 && (args.liveEdits?.length ?? 0) === 0) {
    return "";
  }
  const codingAgent = args.audience === "coding-agent";
  const nameScreen = (screenId: string, filename: string) =>
    (codingAgent ? args.screenRoutes?.[screenId] : undefined) ?? filename;
  const title = args.designTitle?.trim();
  const editPayload = args.edits.map((edit) => ({
    operation: "update-style" as const,
    screenId: edit.screenId,
    ...(edit.routePath ? { routePath: edit.routePath } : {}),
    screen: nameScreen(edit.screenId, edit.filename),
    screenName: edit.screenName,
    selector: edit.selector,
    sourceId: edit.sourceId ?? null,
    sourceAnchor: redactReactSourceAnchor(edit.sourceAnchor),
    provenance: redactReactSourceAnchor(edit.sourceAnchor),
    tagName: edit.tagName ?? null,
    classes: edit.classes,
    styles: edit.styles,
    ...(edit.relativeOperations
      ? { relativeOperations: edit.relativeOperations }
      : {}),
    before: edit.originalStyles,
    after: edit.styles,
    ...(edit.interactionState
      ? { interactionState: edit.interactionState }
      : {}),
    ...(edit.breakpoint ? { breakpoint: edit.breakpoint } : {}),
  }));
  const hasBreakpointScopedEdits = args.edits.some(
    (edit) => edit.breakpoint && edit.breakpoint.upperBoundPx !== null,
  );
  const hasRelativeOperations =
    args.edits.some((edit) => edit.relativeOperations) ||
    (args.liveEdits ?? []).some(
      (edit) => edit.kind === "text" && edit.relativeOperations,
    );
  const reactSourceAnchors = [
    ...args.edits.map((edit) => edit.sourceAnchor),
    ...(args.liveEdits ?? []).flatMap((edit) =>
      edit.kind === "structure"
        ? [edit.sourceAnchor, edit.anchorSourceAnchor]
        : [edit.sourceAnchor],
    ),
  ].filter((anchor): anchor is ReactSourceAnchor => Boolean(anchor));
  const hasReactSourceAnchors = reactSourceAnchors.length > 0;
  const hasRepeatedOrSharedReactScope = reactSourceAnchors.some(
    (anchor) =>
      (anchor.runtimeMultiplicity ?? 1) > 1 ||
      anchor.scope === "repeated-render" ||
      anchor.scope === "shared-component-definition",
  );
  const hasOutsideConnectedRootPaths = reactSourceAnchors.some((anchor) => {
    const redacted = redactReactSourceAnchor(anchor);
    return (
      redacted?.sourcePathStatus === "outside-connected-root" ||
      redacted?.ownerSourcePathStatus === "outside-connected-root"
    );
  });
  const liveEditPayload = (args.liveEdits ?? []).map((edit) => {
    if (edit.kind === "text") {
      return {
        operation: "update-text" as const,
        kind: edit.kind,
        screenId: edit.screenId,
        ...(edit.routePath ? { routePath: edit.routePath } : {}),
        screen: nameScreen(edit.screenId, edit.filename),
        screenName: edit.screenName,
        selector: edit.selector,
        sourceId: edit.sourceId ?? null,
        sourceAnchor: redactReactSourceAnchor(edit.sourceAnchor),
        provenance: redactReactSourceAnchor(edit.sourceAnchor),
        tagName: edit.tagName ?? null,
        classes: edit.classes,
        value: edit.value,
        html: edit.html,
        beforeHtml: edit.originalHtml,
        afterHtml: edit.html,
        ...(edit.relativeOperations
          ? { relativeOperations: edit.relativeOperations }
          : {}),
        before: edit.originalValue,
        after: edit.value,
      };
    }
    if (edit.kind === "layer-state") {
      const semanticHandoff = edit.sourceAnchor
        ? buildRuntimeReactLayerStateHandoff({
            subjectAnchor: edit.sourceAnchor,
            screenId: edit.screenId,
            state: edit.state,
            enabled: edit.enabled,
          })
        : null;
      return {
        operation: "update-layer-state" as const,
        kind: edit.kind,
        screenId: edit.screenId,
        ...(edit.routePath ? { routePath: edit.routePath } : {}),
        screen: nameScreen(edit.screenId, edit.filename),
        screenName: edit.screenName,
        selector: edit.selector,
        sourceId: edit.sourceId ?? null,
        sourceAnchor: redactReactSourceAnchor(edit.sourceAnchor),
        provenance: redactReactSourceAnchor(edit.sourceAnchor),
        tagName: edit.tagName ?? null,
        classes: edit.classes,
        state: edit.state,
        enabled: edit.enabled,
        before: edit.originalEnabled,
        after: edit.enabled,
        attributeName: `data-agent-native-${edit.state}`,
        ...(semanticHandoff?.ok
          ? { semanticHandoff: semanticHandoff.handoff }
          : {}),
      };
    }
    if (edit.kind === "layer-name") {
      return {
        operation: "metadata" as const,
        kind: edit.kind,
        screenId: edit.screenId,
        ...(edit.routePath ? { routePath: edit.routePath } : {}),
        screen: nameScreen(edit.screenId, edit.filename),
        screenName: edit.screenName,
        selector: edit.selector,
        sourceId: edit.sourceId ?? null,
        sourceAnchor: redactReactSourceAnchor(edit.sourceAnchor),
        provenance: redactReactSourceAnchor(edit.sourceAnchor),
        tagName: edit.tagName ?? null,
        classes: edit.classes,
        metadata: "data-agent-native-layer-name",
        before: edit.originalName,
        after: edit.name,
        desiredChange: `Set the source layer metadata name to ${JSON.stringify(edit.name)} for the anchored element. Preserve the existing component structure and use the project's idiomatic naming convention.`,
      };
    }
    const subjectAnchor = edit.sourceAnchor
      ? { ...edit.sourceAnchor, id: "subject" }
      : undefined;
    const targetAnchor = edit.anchorSourceAnchor
      ? { ...edit.anchorSourceAnchor, id: "target" }
      : undefined;
    const insertedHtml = edit.insertedHtml
      ? boundedInsertedHtml(edit.insertedHtml)
      : undefined;
    const semanticHandoff =
      edit.replaced && insertedHtml
        ? subjectAnchor
          ? buildReactSemanticHandoff({
              operation: "replace",
              desiredChange: [
                "Replace the selected runtime element with insertedHtml.",
                insertedHtml.truncated
                  ? "The markup below was truncated for prompt size; read the running preview or ask before writing it verbatim."
                  : "Preserve the replacement markup, styles, and child order shown in the live preview.",
              ].join(" "),
              sourceAnchors: [subjectAnchor],
              runtimeRelationship: {
                kind: "replace",
                subjectAnchorIds: ["subject"],
                screenId: edit.screenId,
                description: `replace ${edit.selector}`,
              },
              versionHashes: [],
            })
          : {
              ok: false as const,
              rejection: {
                code: "missing-source-provenance" as const,
                reason:
                  "The replaced element's source anchor was not available for this runtime replacement.",
              },
            }
        : edit.removed
          ? subjectAnchor
            ? buildReactSemanticHandoff({
                operation: "remove",
                desiredChange:
                  "Delete the selected runtime element from the source that renders it. The live preview already shows it gone; remove its markup (and anything that exists only to render it) without disturbing sibling layout or behavior.",
                sourceAnchors: [subjectAnchor],
                runtimeRelationship: {
                  kind: "remove",
                  subjectAnchorIds: ["subject"],
                  screenId: edit.screenId,
                  description: `remove ${edit.selector}`,
                },
                versionHashes: [],
              })
            : {
                ok: false as const,
                rejection: {
                  code: "missing-source-provenance" as const,
                  reason:
                    "The removed element's source anchor was not available for this runtime deletion.",
                },
              }
          : insertedHtml
            ? targetAnchor
              ? buildReactSemanticHandoff({
                  operation: "insert",
                  desiredChange: [
                    `Add the new markup in insertedHtml ${edit.placement} the target runtime element.`,
                    insertedHtml.truncated
                      ? "The markup below was truncated for prompt size; read the running preview or ask before writing it verbatim."
                      : "The markup is already positioned for the drop point.",
                    edit.dropMode === "absolute-container"
                      ? "The target is an absolute-positioning container; keep the inline left/top offsets."
                      : "This is a flow/auto-layout insertion; the markup carries no absolute positioning.",
                  ].join(" "),
                  sourceAnchors: [targetAnchor],
                  runtimeRelationship: {
                    kind: edit.placement,
                    subjectAnchorIds: [],
                    targetAnchorId: "target",
                    screenId: edit.screenId,
                    description: `insert ${edit.selector} ${edit.placement} ${edit.anchorSelector}`,
                  },
                  versionHashes: [],
                })
              : {
                  ok: false as const,
                  rejection: {
                    code: "missing-source-provenance" as const,
                    reason:
                      "The insertion target's source anchor was not available for this runtime insert.",
                  },
                }
            : subjectAnchor && targetAnchor
              ? buildReactSemanticHandoff({
                  operation: edit.placement === "inside" ? "reparent" : "move",
                  desiredChange: [
                    `Move the selected runtime element ${edit.placement} the target runtime element.`,
                    edit.dropMode === "flow-insert"
                      ? `The drop is a flow/auto-layout insertion${edit.forceFlowPositionOverride ? "; remove authored absolute positioning so the moved element participates in the target container's layout" : "; preserve normal flow participation"}.`
                      : edit.dropMode === "absolute-container"
                        ? "The target is an absolute-positioning container; preserve absolute positioning and rebase the moved element's visual offset from sourceRect into the target anchorRect coordinate space."
                        : "Preserve the runtime layout behavior observed in the preview.",
                    edit.gridPlacement
                      ? `The target is grid cell column ${edit.gridPlacement.column} / ${edit.gridPlacement.columnEnd}, row ${edit.gridPlacement.row} / ${edit.gridPlacement.rowEnd}; preserve this explicit placement in source.`
                      : "",
                    edit.gridDisplacements?.length
                      ? `The target cell was occupied; move ${edit.gridDisplacements.length} displaced element(s) into the recorded free grid cells.`
                      : "",
                  ].join(" "),
                  sourceAnchors: [subjectAnchor, targetAnchor],
                  runtimeRelationship: {
                    kind: edit.placement,
                    subjectAnchorIds: ["subject"],
                    targetAnchorId: "target",
                    screenId: edit.screenId,
                    description: `${edit.selector} ${edit.placement} ${edit.anchorSelector}`,
                  },
                  versionHashes: [],
                })
              : {
                  ok: false as const,
                  rejection: {
                    code: "missing-source-provenance" as const,
                    reason:
                      "Exact subject and target source anchors were not both available for this React structure edit.",
                  },
                };
    return {
      operation: edit.removed
        ? "remove"
        : edit.replaced
          ? "replace"
          : edit.insertedHtml
            ? "insert"
            : edit.placement === "inside"
              ? "reparent"
              : "move",
      kind: edit.kind,
      screenId: edit.screenId,
      ...(edit.routePath ? { routePath: edit.routePath } : {}),
      screen: nameScreen(edit.screenId, edit.filename),
      screenName: edit.screenName,
      ...(edit.transactionId ? { transactionId: edit.transactionId } : {}),
      ...(edit.groupedEdits
        ? {
            groupedEdits: edit.groupedEdits.map((member) => ({
              selector: member.selector,
              ...(member.routePath ? { routePath: member.routePath } : {}),
              sourceId: member.sourceId ?? null,
              sourceAnchor: redactReactSourceAnchor(member.sourceAnchor),
              anchorSelector: member.anchorSelector,
              anchorSourceId: member.anchorSourceId ?? null,
              anchorSourceAnchor: redactReactSourceAnchor(
                member.anchorSourceAnchor,
              ),
              placement: member.placement,
              ...(member.dropMode ? { dropMode: member.dropMode } : {}),
              ...(member.gridPlacement
                ? { gridPlacement: member.gridPlacement }
                : {}),
              ...(member.gridDisplacements
                ? { gridDisplacements: member.gridDisplacements }
                : {}),
            })),
          }
        : {}),
      selector: edit.selector,
      sourceId: edit.sourceId ?? null,
      sourceAnchor: redactReactSourceAnchor(edit.sourceAnchor),
      provenance: {
        subject: redactReactSourceAnchor(edit.sourceAnchor),
        target: redactReactSourceAnchor(edit.anchorSourceAnchor),
      },
      ...(edit.subjectSignature
        ? { subjectSignature: edit.subjectSignature }
        : {}),
      ...(edit.removed || edit.replaced
        ? edit.removed
          ? { removed: true as const }
          : {
              replaced: true as const,
              replacementSelector: edit.replacementSelector,
              replacementSourceId: edit.replacementSourceId ?? null,
              ...(edit.replacementSignature
                ? { replacementSignature: edit.replacementSignature }
                : {}),
            }
        : {
            anchorSelector: edit.anchorSelector,
            anchorSourceId: edit.anchorSourceId ?? null,
            anchorSourceAnchor: redactReactSourceAnchor(
              edit.anchorSourceAnchor,
            ),
            ...(edit.anchorSignature
              ? { anchorSignature: edit.anchorSignature }
              : {}),
            placement: edit.placement,
          }),
      ...(edit.dropMode ? { dropMode: edit.dropMode } : {}),
      ...(edit.routeSourceFile
        ? { routeSourceFile: edit.routeSourceFile }
        : {}),
      ...(edit.forceFlowPositionOverride
        ? { forceFlowPositionOverride: true }
        : {}),
      ...(edit.sourceRect ? { sourceRect: edit.sourceRect } : {}),
      ...(edit.anchorRect ? { anchorRect: edit.anchorRect } : {}),
      ...(edit.gridPlacement ? { gridPlacement: edit.gridPlacement } : {}),
      ...(edit.gridDisplacements
        ? { gridDisplacements: edit.gridDisplacements }
        : {}),
      ...(insertedHtml
        ? {
            insertedHtml: insertedHtml.value,
            ...(insertedHtml.truncated ? { insertedHtmlTruncated: true } : {}),
          }
        : {}),
      ...(semanticHandoff.ok
        ? { semanticHandoff: semanticHandoff.handoff }
        : { semanticHandoffFailure: semanticHandoff.rejection }),
    };
  });

  const activeScreenLabel = args.activeFileId
    ? nameScreen(args.activeFileId, args.activeFilename ?? "")
    : "";
  return [
    codingAgent
      ? `Apply these visual edits${title ? ` to "${title}"` : ""} by editing the app's source.`
      : `Apply these pending live visual edits${title ? ` to "${title}"` : ""}.`,
    codingAgent ? "" : args.designId ? `Design id: "${args.designId}".` : "",
    args.activeFileId
      ? codingAgent
        ? `Screen: ${activeScreenLabel || "the current route"}.`
        : `Active screen: "${args.activeFilename ?? args.activeFileId}" (${args.activeFileId}).`
      : "",
    args.localhostConnectionId && !codingAgent
      ? `Active localhost connection id: "${args.localhostConnectionId}".`
      : "",
    "",
    codingAgent
      ? "These were made against the running app in a visual canvas. Treat each item as a source operation: use provenance/sourceAnchor to locate the owning source, compare before with the live after, and make the smallest idiomatic source edit. Runtime selectors and node ids are correlation hints only; never hand off inline-style mutations as the final implementation. Preserve layout, behavior, and unrelated styling."
      : "Use the Design source tools to make the source match the current live canvas preview. Read each target screen, resolve source ids/selectors through the code-layer projection, then apply the style, text, layer-state, and structure changes with focused source edits. Preserve layout, behavior, and unrelated styling.",
    hasRelativeOperations
      ? "A relativeOperations entry is the authoritative source intent for that property. styles, after, and text html may contain only the immediate DOM-preview result; do not replace calc(), var(), or another authored expression with that absolute preview value. Apply the recorded delta/expression to the existing source expression and preserve its relative semantics."
      : "",
    hasOutsideConnectedRootPaths
      ? "Some source anchors include an absolute or served path outside the connected root. Keep that sourceFile path and the `outside-connected-root` status in the diagnosis; inspect it read-only or ask for the correct connection, and never silently omit the file."
      : "",
    hasReactSourceAnchors && !codingAgent
      ? "React sourceAnchor fields are source provenance; runtime source ids and selectors are correlation hints only. For a single-instance leaf text, literal className/class, or flat literal style-object edit, call apply-visual-edit with source.kind=local-file plus designId, connectionId, the verified project-relative path, and target.sourceAnchor. First omit persist and inspect proposedDiff; then retry with persist=true only when the diff matches the preview. That write still requires human localhost consent and exact version-hash concurrency. Verify every file, line, column, component, and surrounding control flow before editing. Never use a generic AST reparent, group, wrapper, breakpoint, dynamic expression, repeated render, or shared component transform through this path. For semantic structure edits, follow the embedded semanticHandoff packet and use this exact guarded sequence: read-local-file, capture its versionHash, obtain human write consent, write-local-file with expectedVersionHash and requireExpectedVersionHash: true, then keep the preview pending until HMR proves the intended runtime relationship. On a version conflict, re-read and re-plan; never overwrite blindly."
      : "",
    codingAgent &&
    (args.liveEdits ?? []).some((edit) => edit.kind === "structure")
      ? "Design verifies each structure edit via HMR as you write; write file-by-file rather than one final batch write."
      : "",
    hasRepeatedOrSharedReactScope
      ? "At least one React anchor is repeated at runtime or resolves to a shared component definition. Inspect map/conditional/component call sites and confirm whether the change should affect one instance or every instance before writing source."
      : "",
    hasBreakpointScopedEdits
      ? "Edits that carry a `breakpoint` field were made while a narrower breakpoint frame was active: apply them as width-scoped overrides (apply-visual-edit with `activeFrameWidthPx` set to breakpoint.activeWidthPx), NOT as base writes — base values must keep rendering at wider viewports. When breakpoint.editScope is `only`, confine the override to breakpoint.activeWidthPx through breakpoint.upperBoundPx; otherwise use the normal desktop-down cascade."
      : "",
    (args.liveEdits ?? []).some(
      (edit) => edit.kind === "structure" && edit.removed,
    )
      ? "Structure edits carrying `removed: true` are DELETIONS, not moves: the element is already gone from the live preview and must be deleted from the source that renders it. Do not re-create it, and do not read its absent anchor as a half-captured move."
      : "",
    (args.liveEdits ?? []).some(
      (edit) =>
        edit.kind === "structure" &&
        Boolean(edit.insertedHtml) &&
        Boolean(edit.routeSourceFile) &&
        !edit.anchorSourceAnchor,
    )
      ? "A live insert with `routeSourceFile` but no `anchorSourceAnchor` was drawn directly on the screen frame, so its runtime target is the document body rather than a framework-owned element. Treat `routeSourceFile` as the bounded source target, inspect that route's root markup/component, and add `insertedHtml` as a top-level positioned child that matches the live preview. Do not fabricate a body source line or write outside that file unless the route delegates its root markup and you can verify the exact delegated source."
      : "",
    args.edits.some((edit) => edit.interactionState)
      ? "Edits that carry an `interactionState` field are pseudo-class overrides, not base styles. Apply each property only to that exact state (`hover`, `focus`, `focus-visible`, `active`, or `disabled`) while preserving the element's default styling and its other states."
      : "",
    "",
    "Pending style edits:",
    JSON.stringify(editPayload, null, 2),
    liveEditPayload.length > 0
      ? "Pending text/layer-state/structure edits:"
      : "",
    liveEditPayload.length > 0 ? JSON.stringify(liveEditPayload, null, 2) : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function formatVisualEditClipboardPrompt(
  prompt: string,
  host: "chatgpt" | "claude" | "codex" | "webmcp" | null | undefined,
  fullPrompt = false,
  designId?: string | null,
): string {
  const design = designId
    ? ` { designId: "${designId}" }`
    : " using the design ID from this URL";
  if (fullPrompt) {
    return [
      `Apply these visual edits to the connected app's source code.${designId ? ` Design ID: ${designId}.` : ""}`,
      "Use the supplied source provenance to make idiomatic code changes; do not leave editor-only DOM or inline-style mutations as the implementation. Verify the running app after HMR, then use the Agent-Native Design MCP tool get-visual-edit-pending to obtain the current revision, acknowledge only after verification, and pull again to confirm it cleared.",
      "",
      prompt,
    ].join("\n");
  }
  const mcpHandoff = `Use the Agent-Native Design MCP tool get-visual-edit-pending with${design} to pull the latest edits. Apply its instructions to the connected app source, verify the running app, then call acknowledge-visual-edit-pending with the returned revision and pull again to confirm the handoff cleared.`;
  return host === "webmcp"
    ? `${mcpHandoff} If you cannot access the Design MCP server but can use this open Design tab, use its page-local get-visual-edit-prompt WebMCP tool instead.`
    : mcpHandoff;
}

export function isVisualEditHandoffAcknowledged(args: {
  currentRevision: number;
  pendingEditCount: number;
  revision: number | null;
  status: string;
}): boolean {
  return (
    args.pendingEditCount > 0 &&
    args.status === "empty" &&
    args.revision === args.currentRevision
  );
}

export function resolveOverviewScreenSourceType(
  screen:
    | { sourceType?: unknown; bridgeUrl?: string | null }
    | null
    | undefined,
  fallbackSourceType: DesignSourceType = "inline",
): DesignSourceType {
  if (!screen) return fallbackSourceType;
  return (
    normalizeDesignSourceType(screen.sourceType) ??
    (screen.bridgeUrl ? "localhost" : undefined) ??
    fallbackSourceType
  );
}

export function shouldUseRuntimeLayerProjection(args: {
  screen:
    | { sourceType?: unknown; bridgeUrl?: string | null }
    | null
    | undefined;
  fallbackSourceType?: DesignSourceType;
  content: string;
}): boolean {
  if (
    !isRunningAppSourceType(
      resolveOverviewScreenSourceType(
        args.screen,
        args.fallbackSourceType ?? "inline",
      ),
    )
  ) {
    return false;
  }
  try {
    const url = new URL(args.content.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function shouldPreferRuntimeLayerProjection(args: {
  eligible: boolean;
  runtimeNodeCount: number;
  sourceNodeCount: number;
}): boolean {
  void args.sourceNodeCount;
  return args.eligible && args.runtimeNodeCount > 0;
}

export function shouldShowPendingVisualStyleApply(args: {
  edits: readonly PendingVisualStyleEdit[];
  liveEdits?: readonly PendingLiveNonStyleEdit[];
  screenSourceTypes: ReadonlyMap<string, unknown>;
  fallbackSourceType?: unknown;
}): boolean {
  const allEdits = [...args.edits, ...(args.liveEdits ?? [])];
  return (
    allEdits.length > 0 &&
    allEdits.every((edit) =>
      isRunningAppSourceType(
        args.screenSourceTypes.get(edit.screenId) ?? args.fallbackSourceType,
      ),
    )
  );
}

/**
 * §6.4 — One scoped style write (Framer cascade). Routes a single
 * (property, value) edit through the class-vs-media decision
 * (`planBreakpointStyleWrite`) for the active breakpoint scope:
 *
 * - `upperBoundPx == null` (base editing): plain inline-style edit that
 *   cascades down to every narrower breakpoint unless overridden there.
 * - Tailwind-utility value: width-scoped responsive class
 *   (`max-[<bound>px]:utility`), falling back to the media path if the
 *   class patch is rejected.
 * - Raw CSS value: managed `@media (max-width: <bound>px)` rule in the
 *   `<style data-agent-native-breakpoints>` block.
 *
 * Scoped failures return the failing patch rather than silently mutating
 * the base layer — callers surface `result.message`.
 */
export function applyScopedVisualStyleEdit(args: {
  content: string;
  target: { nodeId: string } | { selector: string };
  property: string;
  value: string;
  upperBoundPx: number | null;
  source?: CodeLayerSource;
  lowerBoundPx?: number | null;
}): ApplyVisualEditResult {
  const {
    content,
    target,
    property,
    value,
    upperBoundPx,
    lowerBoundPx,
    source,
  } = args;
  const normalizedProperty = normalizeCssPropertyName(property);
  if (value === "") {
    return applyVisualEdit(
      content,
      upperBoundPx == null
        ? {
            kind: "style",
            operation: "remove",
            target,
            property: normalizedProperty,
          }
        : {
            kind: "breakpoint-style",
            operation: "remove",
            target,
            maxWidthPx: upperBoundPx,
            property: normalizedProperty,
          },
      { source },
    );
  }
  if (upperBoundPx != null && isVectorEndpointProperty(normalizedProperty)) {
    return applyVisualEdit(
      content,
      {
        kind: "breakpoint-style",
        target,
        maxWidthPx: upperBoundPx,
        property: normalizedProperty,
        value,
        operation: "set",
      },
      { source },
    );
  }
  if (
    lowerBoundPx != null &&
    upperBoundPx != null &&
    "nodeId" in target &&
    Number.isFinite(lowerBoundPx) &&
    lowerBoundPx > 0 &&
    upperBoundPx >= lowerBoundPx
  ) {
    const maxPatch = applyVisualEdit(
      content,
      {
        kind: "breakpoint-style",
        target,
        maxWidthPx: upperBoundPx,
        property: normalizedProperty,
        value,
        operation: "set",
      },
      { source },
    );
    if (maxPatch.result.status !== "applied") return maxPatch;
    const withoutCascade = removeBreakpointMediaDeclaration(maxPatch.content, {
      nodeId: target.nodeId,
      maxWidthPx: upperBoundPx,
      property: normalizedProperty,
    });
    return {
      ...maxPatch,
      content: setExactBreakpointDeclaration(withoutCascade, {
        nodeId: target.nodeId,
        property: normalizedProperty,
        value,
        minWidthPx: Math.round(lowerBoundPx),
        maxWidthPx: Math.round(upperBoundPx),
      }),
    };
  }
  const cleanedContent =
    "nodeId" in target
      ? removeExactBreakpointDeclarations(content, {
          nodeId: target.nodeId,
          property: normalizedProperty,
        })
      : content;
  const plan = planBreakpointStyleWrite({ property, value, upperBoundPx });
  if (plan.mode === "class") {
    const rcPatch = applyVisualEdit(
      cleanedContent,
      {
        kind: "responsive-class",
        target,
        prefix: "base",
        maxWidthPx: plan.boundPx,
        operation: "replace",
        utility: plan.utility,
        stem: utilityStem(plan.utility),
      },
      { source },
    );
    if (rcPatch.result.status === "applied") return rcPatch;
    // Fall through to the media path so the edit still lands scoped.
  }
  if (
    plan.mode !== "base" &&
    upperBoundPx !== null &&
    upperBoundPx !== undefined
  ) {
    return applyVisualEdit(
      cleanedContent,
      {
        kind: "breakpoint-style",
        target,
        maxWidthPx: upperBoundPx,
        property,
        value,
        operation: "set",
      },
      { source },
    );
  }
  return applyVisualEdit(
    cleanedContent,
    {
      kind: "style",
      target,
      property,
      value,
    },
    { source },
  );
}

const EXACT_BREAKPOINT_ATTR = "data-agent-native-breakpoint-range";

function exactBreakpointMarker(
  nodeId: string,
  property: string,
  bounds?: { minWidthPx: number; maxWidthPx: number },
): string {
  const base = `${encodeURIComponent(nodeId)}::${encodeURIComponent(property)}`;
  return bounds ? `${base}::${bounds.minWidthPx}-${bounds.maxWidthPx}` : base;
}

function escapeCssAttribute(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeExactBreakpointDeclarations(
  content: string,
  args: {
    nodeId: string;
    property: string;
    minWidthPx?: number;
    maxWidthPx?: number;
  },
): string {
  const marker = exactBreakpointMarker(
    args.nodeId,
    args.property,
    args.minWidthPx != null && args.maxWidthPx != null
      ? { minWidthPx: args.minWidthPx, maxWidthPx: args.maxWidthPx }
      : undefined,
  );
  const markerPattern =
    args.minWidthPx != null && args.maxWidthPx != null
      ? escapeRegExp(marker)
      : `${escapeRegExp(marker)}::[^"]+`;
  const styleRe = new RegExp(
    `<style\\b[^>]*\\b${EXACT_BREAKPOINT_ATTR}="${markerPattern}"[^>]*>.*?<\\/style>\\n?`,
    "gis",
  );
  return content.replace(styleRe, "");
}

function removeExactBreakpointDeclarationsBatch(
  content: string,
  edits: readonly {
    target: { nodeId: string };
    property: string;
  }[],
): string {
  const markerBases = new Set(
    edits.map(({ target, property }) =>
      exactBreakpointMarker(target.nodeId, normalizeCssPropertyName(property)),
    ),
  );
  if (markerBases.size === 0) return content;

  const styleRe = new RegExp(
    `<style\\b[^>]*\\b${EXACT_BREAKPOINT_ATTR}="([^"]+)"[^>]*>.*?<\\/style>\\n?`,
    "gis",
  );
  return content.replace(styleRe, (styleBlock, marker: string) => {
    const separator = marker.lastIndexOf("::");
    return separator > 0 && markerBases.has(marker.slice(0, separator))
      ? ""
      : styleBlock;
  });
}

export function applyScopedVisualStyleBatch(args: {
  content: string;
  source?: CodeLayerSource;
  edits: readonly {
    target: { nodeId: string };
    property: string;
    value: string;
  }[];
}): VisualStyleBatchResult {
  const result = applyOrdinaryVisualStyleBatch(args.content, args.edits, {
    source: args.source,
  });
  if (result.status !== "applied") return result;
  return {
    ...result,
    content: removeExactBreakpointDeclarationsBatch(result.content, args.edits),
  };
}

function setExactBreakpointDeclaration(
  content: string,
  args: {
    nodeId: string;
    property: string;
    value: string;
    minWidthPx: number;
    maxWidthPx: number;
  },
): string {
  const cleaned = removeExactBreakpointDeclarations(content, args);
  const marker = exactBreakpointMarker(args.nodeId, args.property, args);
  const selectorId = escapeCssAttribute(args.nodeId);
  const block = `<style ${EXACT_BREAKPOINT_ATTR}="${marker}">
@media (min-width: ${args.minWidthPx}px) and (max-width: ${args.maxWidthPx}px) {
  [data-agent-native-node-id="${selectorId}"][data-agent-native-node-id="${selectorId}"] {
    ${args.property}: ${args.value.trim()};
  }
}
</style>`;
  const headClose = cleaned.lastIndexOf("</head>");
  return headClose >= 0
    ? `${cleaned.slice(0, headClose)}${block}\n${cleaned.slice(headClose)}`
    : `${block}\n${cleaned}`;
}

/**
 * Pure decision behind commitVisualStyles' commit-or-fail outcome, extracted
 * so the fail-loud contract is unit-testable:
 *
 * - scoped patch applied → its content wins;
 * - scoped patch failed while a BREAKPOINT scope is active → hard error
 *   (the legacy selector fallback is a BASE write and would clobber every
 *   viewport width with a value the user meant to scope — §6.4);
 * - scoped patch failed on BASE scope → the legacy selector-based
 *   inline-style fallback may stand in, but ONLY when it actually resolved
 *   (queryUniqueSelector demands exactly one match — never a guessy write);
 * - nothing resolved → hard error. Callers MUST surface `error` loudly
 *   (toast), never swallow it: a silent no-op here leaves the inspector
 *   displaying a value that was never persisted.
 */
export function resolveVisualStyleCommitContent(args: {
  scopedContent: string;
  scopedFailure: string | null;
  legacyFallbackContent: string | null;
  breakpointScoped: boolean;
}): { content: string } | { error: string | null } {
  if (!args.scopedFailure) return { content: args.scopedContent };
  if (args.breakpointScoped) return { error: args.scopedFailure };
  if (args.legacyFallbackContent)
    return { content: args.legacyFallbackContent };
  return { error: args.scopedFailure };
}

export function applyInteractionStateStyleCommit(
  content: string,
  nodeId: string,
  state: InteractionState,
  styles: Record<string, string>,
  maxWidthPx?: number | null,
): string {
  if (maxWidthPx != null) {
    return upsertResponsiveStateStyles(
      content,
      nodeId,
      state,
      maxWidthPx,
      styles,
    );
  }
  const withStateStyles = upsertStateStyles(content, nodeId, state, styles);
  return duplicateStatePreviewRules(withStateStyles);
}

export function deriveStatePreviewTarget(
  activeState: InteractionState | null,
  screenId: string | null | undefined,
  nodeId: string | null | undefined,
): { screenId: string; nodeId: string; state: InteractionState } | null {
  if (!activeState || !screenId || !nodeId) return null;
  return { screenId, nodeId, state: activeState };
}
