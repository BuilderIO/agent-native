import {
  extractManagedBreakpointCss,
  injectManagedBreakpointCss,
  isSafeBreakpointCssProperty,
  isSafeBreakpointCssValueForProperty,
  parseBreakpointMediaCss,
  serializeBreakpointMediaModel,
  type BreakpointMediaModel,
} from "@shared/breakpoint-media";
import {
  extractManagedInteractionStateCss,
  extractManagedResponsiveInteractionStateCss,
  injectManagedInteractionStateCss,
  injectManagedResponsiveInteractionStateCss,
  isInteractionState,
  isSafeInteractionStateCssProperty,
  isSafeInteractionStateCssValue,
  parseInteractionStatesCss,
  parseResponsiveInteractionStatesCss,
  serializeInteractionStatesModelWithPreviews,
  serializeResponsiveInteractionStatesModel,
  type InteractionState,
  type InteractionStatesModel,
  type ResponsiveInteractionStatesModel,
} from "@shared/interaction-states";

export interface ClipboardBreakpointDeclaration {
  maxWidthPx: number;
  nodeId: string;
  property: string;
  value: string;
}

export interface ClipboardInteractionStateDeclaration {
  maxWidthPx?: number;
  nodeId: string;
  state: InteractionState;
  property: string;
  value: string;
}

export interface DesignClipboardManagedStyleSnapshot {
  version: 1;
  breakpoints: ClipboardBreakpointDeclaration[];
  interactionStates: ClipboardInteractionStateDeclaration[];
}

const MAX_DECLARATIONS = 10_000;
const MAX_BOUND_PX = 10_000_000;

function safeString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function validBound(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_BOUND_PX
  );
}

export function isValidDesignClipboardManagedStyleSnapshot(
  value: unknown,
): value is DesignClipboardManagedStyleSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  if (
    snapshot.version !== 1 ||
    !Array.isArray(snapshot.breakpoints) ||
    !Array.isArray(snapshot.interactionStates) ||
    snapshot.breakpoints.length + snapshot.interactionStates.length >
      MAX_DECLARATIONS
  ) {
    return false;
  }
  const validCommon = (entry: Record<string, unknown>) =>
    safeString(entry.nodeId, 1_024) &&
    safeString(entry.property, 256) &&
    safeString(entry.value, 16_384);
  return (
    snapshot.breakpoints.every((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
      const entry = raw as Record<string, unknown>;
      return (
        validCommon(entry) &&
        validBound(entry.maxWidthPx) &&
        isSafeBreakpointCssProperty(entry.property as string) &&
        isSafeBreakpointCssValueForProperty(
          entry.property as string,
          entry.value as string,
        )
      );
    }) &&
    snapshot.interactionStates.every((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
      const entry = raw as Record<string, unknown>;
      return (
        validCommon(entry) &&
        (entry.maxWidthPx === undefined || validBound(entry.maxWidthPx)) &&
        typeof entry.state === "string" &&
        isInteractionState(entry.state) &&
        isSafeInteractionStateCssProperty(entry.property as string) &&
        isSafeInteractionStateCssValue(entry.value as string)
      );
    })
  );
}

function selectedSubtreeNodeIds(layerHtml: string): Set<string> {
  const nodeIds = new Set<string>();
  const attribute = /\bdata-agent-native-node-id\s*=\s*(["'])([^"']+)\1/gi;
  for (const match of layerHtml.matchAll(attribute)) {
    if (match[2]) nodeIds.add(match[2]);
  }
  return nodeIds;
}

/**
 * Capture only managed declarations owned by the selected subtree. Responsive
 * utility classes need no parallel payload: they already live on the cloned
 * elements' `class` attributes and are copied with the subtree HTML.
 */
export function extractDesignClipboardManagedStyles(
  sourceHtml: string,
  layerHtml: string,
): DesignClipboardManagedStyleSnapshot | undefined {
  const nodeIds = selectedSubtreeNodeIds(layerHtml);
  if (nodeIds.size === 0) return undefined;

  const breakpoints: ClipboardBreakpointDeclaration[] = [];
  const breakpointModel = parseBreakpointMediaCss(
    extractManagedBreakpointCss(sourceHtml) ?? "",
  );
  for (const [bound, nodes] of Object.entries(breakpointModel)) {
    for (const [nodeId, declarations] of Object.entries(nodes)) {
      if (!nodeIds.has(nodeId)) continue;
      for (const [property, value] of Object.entries(declarations)) {
        breakpoints.push({
          maxWidthPx: Number(bound),
          nodeId,
          property,
          value,
        });
      }
    }
  }

  const interactionStates: ClipboardInteractionStateDeclaration[] = [];
  const appendStates = (model: InteractionStatesModel, maxWidthPx?: number) => {
    for (const [nodeId, states] of Object.entries(model)) {
      if (!nodeIds.has(nodeId)) continue;
      for (const [state, declarations] of Object.entries(states)) {
        if (!isInteractionState(state) || !declarations) continue;
        for (const [property, value] of Object.entries(declarations)) {
          interactionStates.push({
            ...(maxWidthPx === undefined ? {} : { maxWidthPx }),
            nodeId,
            state,
            property,
            value,
          });
        }
      }
    }
  };
  appendStates(
    parseInteractionStatesCss(
      extractManagedInteractionStateCss(sourceHtml) ?? "",
    ),
  );
  const responsiveStates = parseResponsiveInteractionStatesCss(
    extractManagedResponsiveInteractionStateCss(sourceHtml) ?? "",
  );
  for (const [bound, model] of Object.entries(responsiveStates)) {
    appendStates(model, Number(bound));
  }

  if (breakpoints.length === 0 && interactionStates.length === 0) {
    return undefined;
  }
  return { version: 1, breakpoints, interactionStates };
}

/**
 * Merge remapped declarations into the target document in the same content
 * value as the cloned DOM insertion. Model serialization preserves the
 * desktop-down cascade and makes repeated application with the same id map
 * byte-idempotent rather than appending duplicate raw rules.
 */
export function applyDesignClipboardManagedStyles(
  targetHtml: string,
  snapshots: Array<DesignClipboardManagedStyleSnapshot | null | undefined>,
  nodeIdMap: ReadonlyMap<string, string>,
): string {
  if (snapshots.length === 0 || nodeIdMap.size === 0) return targetHtml;

  const breakpoints: BreakpointMediaModel = parseBreakpointMediaCss(
    extractManagedBreakpointCss(targetHtml) ?? "",
  );
  const states: InteractionStatesModel = parseInteractionStatesCss(
    extractManagedInteractionStateCss(targetHtml) ?? "",
  );
  const responsiveStates: ResponsiveInteractionStatesModel =
    parseResponsiveInteractionStatesCss(
      extractManagedResponsiveInteractionStateCss(targetHtml) ?? "",
    );

  for (const snapshot of snapshots) {
    if (!isValidDesignClipboardManagedStyleSnapshot(snapshot)) continue;
    for (const declaration of snapshot.breakpoints) {
      const targetNodeId = nodeIdMap.get(declaration.nodeId);
      if (!targetNodeId) continue;
      const bound = String(declaration.maxWidthPx);
      breakpoints[bound] ??= {};
      breakpoints[bound][targetNodeId] ??= {};
      breakpoints[bound][targetNodeId][declaration.property] =
        declaration.value;
    }
    for (const declaration of snapshot.interactionStates) {
      const targetNodeId = nodeIdMap.get(declaration.nodeId);
      if (!targetNodeId) continue;
      const targetModel =
        declaration.maxWidthPx === undefined
          ? states
          : (responsiveStates[String(declaration.maxWidthPx)] ??= {});
      targetModel[targetNodeId] ??= {};
      targetModel[targetNodeId][declaration.state] ??= {};
      targetModel[targetNodeId][declaration.state]![declaration.property] =
        declaration.value;
    }
  }

  let nextHtml = injectManagedBreakpointCss(
    targetHtml,
    serializeBreakpointMediaModel(breakpoints),
  );
  nextHtml = injectManagedInteractionStateCss(
    nextHtml,
    serializeInteractionStatesModelWithPreviews(states),
  );
  return injectManagedResponsiveInteractionStateCss(
    nextHtml,
    serializeResponsiveInteractionStatesModel(responsiveStates),
  );
}
