import { removeBreakpointMediaDeclaration } from "@shared/breakpoint-media";
import {
  applyVisualEdit,
  type ApplyVisualEditResult,
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
  normalizeDesignSourceType,
  type DesignSourceType,
} from "@shared/source-mode";

import type { ElementInfo } from "@/components/design/types";

import {
  buildReactSemanticHandoff,
  buildRuntimeReactLayerStateHandoff,
  redactReactSourceAnchor,
  type ReactSourceAnchor,
  type ReactSourceScope,
} from "./react-semantic-handoff";
import { camelStyleProperty } from "./style-utils";

export interface PendingVisualStyleEdit {
  screenId: string;
  filename: string;
  screenName: string;
  selector: string;
  sourceId?: string | null;
  /**
   * The selector/node id the canvas bridge reported, kept when the host
   * canonicalized the selection onto its source projection
   * (canonicalElementInfoForCodeLayerNode). A localhost screen runs two
   * disjoint node-id namespaces: the injected bridge stamps `runtime-…` ids on
   * the live document, while the host stamps `an-…` ids on the source html it
   * fetched separately. Only this pair addresses the running app, so every
   * replay into the live frame must prefer it. Absent for inline/snapshot
   * screens, where the bridge reuses the ids already in the document and the
   * two pairs are the same value.
   */
  runtimeSelector?: string | null;
  runtimeSourceId?: string | null;
  sourceAnchor?: ReactSourceAnchor;
  tagName?: string | null;
  classes: string[];
  styles: Record<string, string>;
  /**
   * Element pseudo-class being authored. Omitted for ordinary/base styles.
   * Localhost screens cannot persist the editor's managed HTML block because
   * their DesignFile content is the route URL, so interaction-state edits use
   * the same guarded coding-agent handoff as other live visual edits while the
   * iframe bridge keeps a temporary state-scoped preview.
   */
  interactionState?: InteractionState;
  /** Base computed values used only to restore inspector fields after the
   * first pending state override is undone. Runtime preview cleanup still
   * uses `originalStyles` (empty values remove the temporary CSSOM rule). */
  baseStyles?: Record<string, string>;
  /**
   * Inline style values to replay when the user discards the live preview.
   * Missing authored inline values are stored as "" so the bridge removes the
   * temporary inline style and lets the app's real CSS win again.
   */
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

function pendingLiveEditSubjectKey(edit: PendingLiveNonStyleEdit): string {
  return `${edit.screenId}:${edit.sourceId?.trim() || edit.selector.trim()}`;
}

export function mergePendingLiveNonStyleEdits(
  edits: readonly PendingLiveNonStyleEdit[],
): PendingLiveNonStyleEdit[] {
  const merged: PendingLiveNonStyleEdit[] = [];
  for (const edit of edits) {
    if (edit.kind === "structure") {
      // Deleting a node this session INSERTED nets to zero in source: the
      // markup was never written there. Queuing both would hand the coding
      // agent markup to add plus a node to delete, and an apply that runs the
      // insert can resurrect exactly what the user deleted. Both entries stay
      // on the undo stack, so undoing the delete re-queues the insertion.
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
    merged[index] = {
      ...previous,
      ...edit,
      originalValue: previous.originalValue,
      originalHtml: previous.originalHtml,
    };
  }
  return merged;
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
  filename: string;
  screenName: string;
  selector: string;
  sourceId?: string | null;
  sourceAnchor?: ReactSourceAnchor;
  tagName?: string | null;
  classes: string[];
  value: string;
  html?: string;
  originalValue: string;
  originalHtml?: string;
  updatedAt: number;
}

export interface PendingLiveLayerStateEdit {
  kind: "layer-state";
  screenId: string;
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
  filename: string;
  screenName: string;
  selector: string;
  sourceId?: string | null;
  sourceAnchor?: ReactSourceAnchor;
  anchorSelector: string;
  anchorSourceId?: string | null;
  anchorSourceAnchor?: ReactSourceAnchor;
  /**
   * Project-relative route module reported by the localhost manifest. A
   * top-level canvas insert targets the live document body, which intentionally
   * has no framework element provenance; this keeps Apply bounded to the route
   * source without inventing a fake body line/column.
   */
  routeSourceFile?: string;
  placement: "before" | "after" | "inside";
  /** Runtime layout semantics captured at drop time. These are required for
   * the coding agent to distinguish a flow/auto-layout insertion from an
   * absolute child whose visual offset must be rebased into its new parent. */
  dropMode?: "flow-insert" | "absolute-container";
  forceFlowPositionOverride?: boolean;
  sourceRect?: { x: number; y: number; width: number; height: number };
  anchorRect?: { x: number; y: number; width: number; height: number };
  /**
   * Markup this edit ADDED to the running app. Present only for a drop whose
   * subject had no counterpart in the screen's source, so the coding agent
   * must insert this markup rather than relocate an existing element.
   */
  insertedHtml?: string;
  /** The inserted markup replaced `selector` instead of landing beside it. */
  replaced?: true;
  /** Runtime identity of the optimistic replacement used for verification. */
  replacementSelector?: string;
  replacementSourceId?: string | null;
  /**
   * This edit DELETED the subject from the running app. A removal has no
   * anchor — `anchorSelector`/`placement` carry no meaning for it — so every
   * consumer that pairs a subject with a target (the semantic handoff, the
   * source-path collection before apply, runtime verification) must branch on
   * this instead of reading anchor fields that were never captured.
   */
  removed?: true;
  requestId?: string;
  updatedAt: number;
}

/**
 * Convert bridge provenance into a bounded semantic source anchor. Runtime
 * ids remain useful for correlating the live preview, but they are never
 * treated as source identities by the coding-agent handoff.
 */
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
    // `C:foo` is drive-relative and must not be treated as a project path.
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
    // URL-like values and unsupported drive-relative paths are not files.
    return undefined;
  }

  const segments: string[] = [];
  for (const segment of remainder.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0) {
        segments.pop();
      } else if (!absolute) {
        // A relative path may not escape its unknown project root.
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
    // Keep the raw Fiber value only in local state. Prompt serialization goes
    // through redactReactSourceAnchor, which omits absolute paths until the
    // connection root has resolved them to a safe project-relative relPath.
    sourceFile,
    ...(relPath ? { relPath } : {}),
    line: provenance.line,
    column: provenance.column,
    // Which tier produced line/column, so no consumer can read a React 19
    // owner-stack (transformed) position as the authored JSX line.
    ...(provenance.method ? { method: provenance.method } : {}),
    component: provenance.component,
    // The nearest component's INSTANTIATION site — the `.map()` call site for a
    // mapped instance. Dropping it here is what left the handoff unable to say
    // where a mapped sibling actually comes from.
    ...(ownerSourceFile ? { ownerSourceFile } : {}),
    ...(ownerRelPath ? { ownerRelPath } : {}),
    ...(provenance.ownerLine ? { ownerLine: provenance.ownerLine } : {}),
    ...(provenance.ownerColumn ? { ownerColumn: provenance.ownerColumn } : {}),
    ...(provenance.ownerComponentName
      ? { ownerComponent: provenance.ownerComponentName }
      : {}),
    // The owner's own tier: a data-attribute element can still owe its owner
    // line to a transformed owner stack.
    ...(provenance.ownerMethod ? { ownerMethod: provenance.ownerMethod } : {}),
    // Every `.map()` sibling shares one call site, so runtimeMultiplicity alone
    // cannot say WHICH instance was selected; the React key can.
    ...(provenance.ownerKey ? { ownerKey: provenance.ownerKey } : {}),
    runtimeMultiplicity,
    ...(args.reason?.trim() ? { reason: args.reason.trim() } : {}),
    scope:
      args.scope ?? (runtimeMultiplicity > 1 ? "repeated-render" : "unknown"),
  };
}

/**
 * Why an anchor could not be built: a runtime that reports it exposes no
 * source locations at all is a permanent answer, not a slow one. Returns
 * undefined when nothing has reported a reason yet — that case is still
 * "loading", and callers must not present it as unsupported.
 */
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
  | PendingLiveStructureEdit;
export type PendingVisualStyleUndoEntry = {
  edit: PendingVisualStyleEdit;
  revertStyles: Record<string, string>;
};
export type PendingLiveTextUndoEntry = {
  kind: "text";
  edit: PendingLiveTextEdit;
  revertValue: string;
  revertHtml?: string;
};
export type PendingLiveStructureUndoEntry = {
  kind: "structure";
  edit: PendingLiveStructureEdit;
};
export type PendingLiveLayerStateUndoEntry = {
  kind: "layer-state";
  edit: PendingLiveLayerStateEdit;
  revertEnabled: boolean;
};
export type PendingLiveNonStyleUndoEntry =
  | PendingLiveTextUndoEntry
  | PendingLiveLayerStateUndoEntry
  | PendingLiveStructureUndoEntry;

/**
 * Project-relative source files that must be read before this edit can be
 * handed off. A removal has no anchor, and an INSERT has no subject — its
 * markup exists in no source file yet — so demanding both paths rejected every
 * insert as "anchors still loading". `null` means a path this edit does need
 * has not resolved yet, which is the only honest "not ready" answer.
 */
export function pendingStructureEditSourcePaths(
  edit: PendingLiveStructureEdit,
): string[] | null {
  const required = [
    ...(edit.insertedHtml && !edit.replaced
      ? []
      : [edit.sourceAnchor?.relPath]),
    ...(edit.removed || edit.replaced
      ? []
      : [
          edit.anchorSourceAnchor?.relPath ??
            (edit.insertedHtml ? edit.routeSourceFile : undefined),
        ]),
  ];
  if (required.some((path) => !path)) return null;
  return required as string[];
}

export type PendingStructureRedoCommand =
  | { kind: "delete" }
  | { kind: "insert"; html: string; replaceAnchor?: boolean }
  | { kind: "move" };

/**
 * Which runtime command replays this edit. Undoing an insert REMOVED the node,
 * so replaying it as a move would address an element that is no longer in the
 * document and the bridge would return silently — a redo that reports success
 * and does nothing.
 */
export function pendingStructureRedoCommand(
  edit: PendingLiveStructureEdit,
): PendingStructureRedoCommand {
  if (edit.removed) return { kind: "delete" };
  return edit.insertedHtml
    ? {
        kind: "insert",
        html: edit.insertedHtml,
        ...(edit.replaced ? { replaceAnchor: true } : {}),
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
    edit.sourceId?.trim() || edit.selector.trim() || "unknown",
    edit.interactionState ?? "default",
  ].join("::");
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
      originalStyles: {
        ...nextEdit.originalStyles,
        ...edit.originalStyles,
      },
      baseStyles: edit.baseStyles ?? nextEdit.baseStyles,
    };
  });
  return merged ? next : [...edits, nextEdit];
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
      selector: edit.selector,
      sourceId: edit.sourceId,
      // Carried, not resolved: consumers replay into the live frame (prefer the
      // runtime pair) and into the source projection (prefer the canonical
      // one), so the patch has to keep both.
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
  selector: string;
  sourceId?: string | null;
  runtimeSelector?: string | null;
  runtimeSourceId?: string | null;
  styles: Record<string, string>;
};

function nodeIdSelector(nodeId: string): string {
  return `[data-agent-native-node-id="${nodeId
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')}"]`;
}

/**
 * How a pending edit addresses the RUNNING document. The runtime pair wins
 * because a localhost screen's canonical selector/sourceId name nodes in the
 * host's source projection, which the live frame has never seen. Candidates
 * stay a runtime-first superset so nothing that used to resolve stops
 * resolving, and an inline screen — which records no runtime pair — produces
 * byte-identical output to the canonical-only list.
 */
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
  },
) => boolean;

/**
 * Forward, undo, and redo all use this exact per-property runtime channel.
 * The screen id is part of the command boundary so a retained/remounted
 * overview iframe cannot accidentally receive history intended for another
 * screen.
 */
export function replayPendingVisualStyleRuntimePatch(
  patch: PendingVisualStyleRuntimePatch,
  sendProperty: SendPendingVisualStyleRuntimeProperty,
): boolean {
  const entries = Object.entries(patch.styles);
  if (entries.length === 0) return false;
  const target = runtimeStyleTarget(patch);
  // No candidate at all is not "apply it to the obvious element": the bridge
  // falls back to its own current selection when the candidate list is empty,
  // so an unaddressable revert would silently restyle whatever happens to be
  // selected. Report failure and let the caller surface it.
  if (target.selectorCandidates.length === 0) return false;
  return entries.every(([property, value]) =>
    sendProperty(patch.screenId, target.selector, property, value, {
      selectorCandidates: target.selectorCandidates,
      nodeId: target.nodeId,
    }),
  );
}

/**
 * Badge number on the Apply bar: how many user-meaningful updates Apply would
 * hand to the agent. A style edit is already coalesced by screen, target, and
 * interaction state, so counting its individual CSS declarations inflates one
 * inspector gesture into several apparent updates.
 */
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

/**
 * Inserted markup is the only unbounded field in the pending-edit payload, and
 * that payload is JSON.stringified straight into an agent prompt. Truncation is
 * reported so the agent never mistakes a cut-off tree for the whole node.
 */
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
}): string {
  const title = args.designTitle?.trim();
  const editPayload = args.edits.map((edit) => ({
    screenId: edit.screenId,
    filename: edit.filename,
    screenName: edit.screenName,
    selector: edit.selector,
    sourceId: edit.sourceId ?? null,
    sourceAnchor: redactReactSourceAnchor(edit.sourceAnchor),
    tagName: edit.tagName ?? null,
    classes: edit.classes,
    styles: edit.styles,
    ...(edit.interactionState
      ? { interactionState: edit.interactionState }
      : {}),
    ...(edit.breakpoint ? { breakpoint: edit.breakpoint } : {}),
  }));
  const hasBreakpointScopedEdits = args.edits.some(
    (edit) => edit.breakpoint && edit.breakpoint.upperBoundPx !== null,
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
  const liveEditPayload = (args.liveEdits ?? []).map((edit) => {
    if (edit.kind === "text") {
      return {
        kind: edit.kind,
        screenId: edit.screenId,
        filename: edit.filename,
        screenName: edit.screenName,
        selector: edit.selector,
        sourceId: edit.sourceId ?? null,
        sourceAnchor: redactReactSourceAnchor(edit.sourceAnchor),
        tagName: edit.tagName ?? null,
        classes: edit.classes,
        value: edit.value,
        html: edit.html,
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
        kind: edit.kind,
        screenId: edit.screenId,
        filename: edit.filename,
        screenName: edit.screenName,
        selector: edit.selector,
        sourceId: edit.sourceId ?? null,
        sourceAnchor: redactReactSourceAnchor(edit.sourceAnchor),
        tagName: edit.tagName ?? null,
        classes: edit.classes,
        state: edit.state,
        enabled: edit.enabled,
        attributeName: `data-agent-native-${edit.state}`,
        ...(semanticHandoff?.ok
          ? { semanticHandoff: semanticHandoff.handoff }
          : {}),
      };
    }
    const subjectAnchor = edit.sourceAnchor
      ? { ...edit.sourceAnchor, id: "subject" }
      : undefined;
    const targetAnchor = edit.anchorSourceAnchor
      ? { ...edit.anchorSourceAnchor, id: "target" }
      : undefined;
    // An insert's subject is markup that does not exist in the program yet, so
    // it has no source anchor and cannot be described as a move. Telling the
    // agent to relocate an element the file has never contained is worse than
    // reporting nothing.
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
                  ].join(" "),
                  sourceAnchors: [subjectAnchor, targetAnchor],
                  runtimeRelationship: {
                    kind: edit.placement,
                    subjectAnchorIds: ["subject"],
                    targetAnchorId: "target",
                    screenId: edit.screenId,
                    description: `${edit.selector} ${edit.placement} ${edit.anchorSelector}`,
                  },
                  // The packet intentionally starts without a hash: its execution
                  // contract requires read-local-file before every write.
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
      kind: edit.kind,
      screenId: edit.screenId,
      filename: edit.filename,
      screenName: edit.screenName,
      selector: edit.selector,
      sourceId: edit.sourceId ?? null,
      sourceAnchor: redactReactSourceAnchor(edit.sourceAnchor),
      // A removal has no anchor; emitting empty anchor fields alongside a
      // meaningless placement reads as a half-captured move.
      ...(edit.removed || edit.replaced
        ? edit.removed
          ? { removed: true as const }
          : {
              replaced: true as const,
              replacementSelector: edit.replacementSelector,
              replacementSourceId: edit.replacementSourceId ?? null,
            }
        : {
            anchorSelector: edit.anchorSelector,
            anchorSourceId: edit.anchorSourceId ?? null,
            anchorSourceAnchor: redactReactSourceAnchor(
              edit.anchorSourceAnchor,
            ),
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

  return [
    `Apply these pending live visual edits${title ? ` to "${title}"` : ""}.`,
    args.designId ? `Design id: "${args.designId}".` : "",
    args.activeFileId
      ? `Active screen: "${args.activeFilename ?? args.activeFileId}" (${args.activeFileId}).`
      : "",
    args.localhostConnectionId
      ? `Active localhost connection id: "${args.localhostConnectionId}".`
      : "",
    "",
    "Use the Design source tools to make the source match the current live canvas preview. Read each target screen, resolve source ids/selectors through the code-layer projection, then apply the style, text, layer-state, and structure changes with focused source edits. Preserve layout, behavior, and unrelated styling.",
    hasReactSourceAnchors
      ? "React sourceAnchor fields are source provenance; runtime source ids and selectors are correlation hints only. For a single-instance leaf text, literal className/class, or flat literal style-object edit, call apply-visual-edit with source.kind=local-file plus designId, connectionId, the verified project-relative path, and target.sourceAnchor. First omit persist and inspect proposedDiff; then retry with persist=true only when the diff matches the preview. That write still requires human localhost consent and exact version-hash concurrency. Verify every file, line, column, component, and surrounding control flow before editing. Never use a generic AST reparent, group, wrapper, breakpoint, dynamic expression, repeated render, or shared component transform through this path. For semantic structure edits, follow the embedded semanticHandoff packet and use this exact guarded sequence: read-local-file, capture its versionHash, obtain human write consent, write-local-file with expectedVersionHash and requireExpectedVersionHash: true, then keep the preview pending until HMR proves the intended runtime relationship. On a version conflict, re-read and re-plan; never overwrite blindly."
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
    resolveOverviewScreenSourceType(
      args.screen,
      args.fallbackSourceType ?? "inline",
    ) !== "localhost"
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
  // A hydrated localhost tree is the visible app's ground truth even when SSR
  // happened to emit the same number of nodes (or more wrappers). Keep the
  // source projection separately for writes; never use counts to decide which
  // tree represents the live Layers panel.
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
    allEdits.every(
      (edit) =>
        normalizeDesignSourceType(
          args.screenSourceTypes.get(edit.screenId) ?? args.fallbackSourceType,
        ) === "localhost",
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
  /** Inclusive lower bound for an exact-range edit. Omit for the normal
   * desktop-down “this breakpoint and smaller” cascade. */
  lowerBoundPx?: number | null;
}): ApplyVisualEditResult {
  const { content, target, property, value, upperBoundPx, lowerBoundPx } = args;
  const normalizedProperty = normalizeCssPropertyName(property);
  if (
    lowerBoundPx != null &&
    upperBoundPx != null &&
    "nodeId" in target &&
    Number.isFinite(lowerBoundPx) &&
    lowerBoundPx > 0 &&
    upperBoundPx >= lowerBoundPx
  ) {
    const maxPatch = applyVisualEdit(content, {
      kind: "breakpoint-style",
      target,
      maxWidthPx: upperBoundPx,
      property: normalizedProperty,
      value,
      operation: "set",
    });
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
    const rcPatch = applyVisualEdit(cleanedContent, {
      kind: "responsive-class",
      target,
      // `prefix` is ignored when maxWidthPx is set (desktop-down scope).
      prefix: "base",
      maxWidthPx: plan.boundPx,
      operation: "replace",
      utility: plan.utility,
      stem: utilityStem(plan.utility),
    });
    if (rcPatch.result.status === "applied") return rcPatch;
    // Fall through to the media path so the edit still lands scoped.
  }
  if (
    plan.mode !== "base" &&
    upperBoundPx !== null &&
    upperBoundPx !== undefined
  ) {
    return applyVisualEdit(cleanedContent, {
      kind: "breakpoint-style",
      target,
      maxWidthPx: upperBoundPx,
      property,
      value,
      operation: "set",
    });
  }
  return applyVisualEdit(cleanedContent, {
    kind: "style",
    target,
    property,
    value,
  });
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
      : `${escapeRegExp(marker)}::[^\"]+`;
  const styleRe = new RegExp(
    `<style\\b[^>]*\\b${EXACT_BREAKPOINT_ATTR}="${markerPattern}"[^>]*>.*?<\\/style>\\n?`,
    "gis",
  );
  return content.replace(styleRe, "");
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

/**
 * Interaction-states phase 2 — the pure content transform behind
 * `commitInteractionStateStyles` (DesignEditor's useCallback wrapper, which
 * only resolves `activeFile`/`selectedElement`/`canEditDesign` and calls
 * `applyFileContentUpdate`). Extracted as a top-level function so it's
 * unit-testable the same way `applyScopedVisualStyleEdit` is above.
 *
 * Writes every property in `styles` into the managed
 * `[data-agent-native-node-id="<nodeId>"]:<state> { … }` rule
 * (`upsertStateStyles`) and regenerates that rule's forced-preview twin
 * (`duplicateStatePreviewRules`) in one pass, so a caller that folds the
 * result into a single `applyFileContentUpdate`/history-recording call gets
 * exactly one undo step for the whole commit — see
 * `shared/interaction-states.ts`'s module doc for the twin-rule mechanism.
 */
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

/**
 * Interaction-states phase 2 — the pure decision behind `statePreviewTarget`,
 * the value DesignEditor forwards into both the single-screen and overview
 * `DesignCanvas` instances' `statePreviewTarget` prop, which in turn drives
 * the `state-preview` postMessage that sets/clears the bridge's
 * `data-an-state-preview` attribute (see interaction-states.ts's "Forced-
 * preview mechanism" doc comment for the full pipeline). Returns null
 * whenever there's no active non-default interaction state OR no resolvable
 * single-element screen/node target — both must be present for a preview to
 * make sense, matching EditPanel's InteractionStatePanel only ever offering
 * the state selector for a single selection with a stable node id.
 */
export function deriveStatePreviewTarget(
  activeState: InteractionState | null,
  screenId: string | null | undefined,
  nodeId: string | null | undefined,
): { screenId: string; nodeId: string; state: InteractionState } | null {
  if (!activeState || !screenId || !nodeId) return null;
  return { screenId, nodeId, state: activeState };
}
