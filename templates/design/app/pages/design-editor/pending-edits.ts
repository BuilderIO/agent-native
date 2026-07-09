import {
  applyVisualEdit,
  type ApplyVisualEditResult,
} from "@shared/code-layer";
import {
  duplicateStatePreviewRules,
  type InteractionState,
  upsertStateStyles,
} from "@shared/interaction-states";
import {
  planBreakpointStyleWrite,
  utilityStem,
} from "@shared/responsive-classes";
import {
  normalizeDesignSourceType,
  type DesignSourceType,
} from "@shared/source-mode";

import type { ElementInfo } from "@/components/design/types";

import { camelStyleProperty } from "./style-utils";

export interface PendingVisualStyleEdit {
  screenId: string;
  filename: string;
  screenName: string;
  selector: string;
  sourceId?: string | null;
  tagName?: string | null;
  classes: string[];
  styles: Record<string, string>;
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
  };
}

function pendingLiveTextEditKey(edit: PendingLiveTextEdit): string {
  return `${edit.screenId}:${edit.sourceId?.trim() || edit.selector.trim()}`;
}

export function mergePendingLiveNonStyleEdits(
  edits: readonly PendingLiveNonStyleEdit[],
): PendingLiveNonStyleEdit[] {
  const merged: PendingLiveNonStyleEdit[] = [];
  for (const edit of edits) {
    if (edit.kind === "structure") {
      merged.push(edit);
      continue;
    }
    const nextKey = pendingLiveTextEditKey(edit);
    const index = merged.findIndex(
      (candidate) =>
        candidate.kind === "text" &&
        pendingLiveTextEditKey(candidate) === nextKey,
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
      pendingLiveTextEditKey(edit) === pendingLiveTextEditKey(nextEdit),
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
  tagName?: string | null;
  classes: string[];
  value: string;
  html?: string;
  originalValue: string;
  originalHtml?: string;
  updatedAt: number;
}

export interface PendingLiveStructureEdit {
  kind: "structure";
  screenId: string;
  filename: string;
  screenName: string;
  selector: string;
  sourceId?: string | null;
  anchorSelector: string;
  anchorSourceId?: string | null;
  placement: "before" | "after" | "inside";
  requestId?: string;
  updatedAt: number;
}

export type PendingLiveNonStyleEdit =
  | PendingLiveTextEdit
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
export type PendingLiveNonStyleUndoEntry =
  | PendingLiveTextUndoEntry
  | PendingLiveStructureUndoEntry;

function pendingVisualStyleEditKey(edit: PendingVisualStyleEdit): string {
  return [
    edit.screenId,
    edit.sourceId?.trim() || edit.selector.trim() || "unknown",
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

export function buildPendingVisualStyleRevertPatches(
  edits: readonly PendingVisualStyleEdit[],
): Array<{
  screenId: string;
  selector: string;
  sourceId?: string | null;
  styles: Record<string, string>;
}> {
  return edits
    .map((edit) => ({
      screenId: edit.screenId,
      selector: edit.selector,
      sourceId: edit.sourceId,
      styles: edit.originalStyles,
    }))
    .filter((patch) => Object.keys(patch.styles).length > 0);
}

export function getPendingVisualStylePropertyCount(
  edits: readonly PendingVisualStyleEdit[],
): number {
  return edits.reduce(
    (count, edit) => count + Object.keys(edit.styles).length,
    0,
  );
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

export function formatPendingVisualStylePrompt(args: {
  designId?: string | null;
  designTitle?: string | null;
  activeFileId?: string | null;
  activeFilename?: string | null;
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
    tagName: edit.tagName ?? null,
    classes: edit.classes,
    styles: edit.styles,
    ...(edit.breakpoint ? { breakpoint: edit.breakpoint } : {}),
  }));
  const hasBreakpointScopedEdits = args.edits.some(
    (edit) => edit.breakpoint && edit.breakpoint.upperBoundPx !== null,
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
        tagName: edit.tagName ?? null,
        classes: edit.classes,
        value: edit.value,
        html: edit.html,
      };
    }
    return {
      kind: edit.kind,
      screenId: edit.screenId,
      filename: edit.filename,
      screenName: edit.screenName,
      selector: edit.selector,
      sourceId: edit.sourceId ?? null,
      anchorSelector: edit.anchorSelector,
      anchorSourceId: edit.anchorSourceId ?? null,
      placement: edit.placement,
    };
  });

  return [
    `Apply these pending live visual edits${title ? ` to "${title}"` : ""}.`,
    args.designId ? `Design id: "${args.designId}".` : "",
    args.activeFileId
      ? `Active screen: "${args.activeFilename ?? args.activeFileId}" (${args.activeFileId}).`
      : "",
    "",
    "Use the Design source tools to make the source match the current live canvas preview. Read each target screen, resolve source ids/selectors through the code-layer projection, then apply the style, text, and structure changes with focused source edits. Preserve layout, behavior, and unrelated styling.",
    hasBreakpointScopedEdits
      ? "Edits that carry a `breakpoint` field were made while a narrower breakpoint frame was active: apply them as width-scoped overrides (apply-visual-edit with `activeFrameWidthPx` set to breakpoint.activeWidthPx), NOT as base writes — base values must keep rendering at wider viewports."
      : "",
    "",
    "Pending style edits:",
    JSON.stringify(editPayload, null, 2),
    liveEditPayload.length > 0 ? "Pending text/structure edits:" : "",
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
}): ApplyVisualEditResult {
  const { content, target, property, value, upperBoundPx } = args;
  const plan = planBreakpointStyleWrite({ property, value, upperBoundPx });
  if (plan.mode === "class") {
    const rcPatch = applyVisualEdit(content, {
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
    return applyVisualEdit(content, {
      kind: "breakpoint-style",
      target,
      maxWidthPx: upperBoundPx,
      property,
      value,
      operation: "set",
    });
  }
  return applyVisualEdit(content, { kind: "style", target, property, value });
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
): string {
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
