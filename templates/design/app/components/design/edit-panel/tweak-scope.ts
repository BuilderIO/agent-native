import type { TweakDefinition, TweakScope } from "@shared/api";

import type { ElementInfo } from "../types";

export interface TweakSelectionTarget {
  screenId: string;
  /** Absent when the screen itself is selected. */
  element?: Pick<
    ElementInfo,
    | "sourceId"
    | "runtimeSourceId"
    | "selector"
    | "runtimeSelector"
    | "parentAutoLayout"
    | "childLayouts"
  >;
}

export function tweakTargetsForSelection(args: {
  elements: readonly Pick<
    ElementInfo,
    | "sourceId"
    | "runtimeSourceId"
    | "selector"
    | "runtimeSelector"
    | "parentAutoLayout"
    | "childLayouts"
    | "sourceLayerIdentity"
  >[];
  fallbackScreenId?: string;
  screenId?: string;
}): TweakSelectionTarget[] {
  if (args.elements.length === 0) {
    return args.screenId ? [{ screenId: args.screenId }] : [];
  }
  const targets = args.elements.flatMap((element) => {
    const screenId =
      element.sourceLayerIdentity?.screenId ?? args.fallbackScreenId;
    return screenId ? [{ screenId, element }] : [];
  });
  return targets;
}

const NODE_ID_ATTRIBUTE = "data-agent-native-node-id";

function elementNodeIds(element: TweakSelectionTarget["element"]): string[] {
  return [element?.sourceId, element?.runtimeSourceId].filter(
    (id): id is string => Boolean(id),
  );
}

function elementSelectors(element: TweakSelectionTarget["element"]): string[] {
  return [element?.selector, element?.runtimeSelector].filter(
    (selector): selector is string => Boolean(selector),
  );
}

function queryOne(doc: Document, selector: string): Element | null {
  try {
    return doc.querySelector(selector);
  } catch {
    // coercion-ok: an invalid authored selector matches no element, so the
    // tweak is not shown for this selection; it is never reported as applied.
    return null;
  }
}

function findByNodeIds(doc: Document, ids: string[]): Element | null {
  for (const id of ids) {
    const found = queryOne(doc, `[${NODE_ID_ATTRIBUTE}="${CSS.escape(id)}"]`);
    if (found) return found;
  }
  return null;
}

function findScopeElement(doc: Document, scope: TweakScope): Element | null {
  return (
    (scope.nodeId ? findByNodeIds(doc, [scope.nodeId]) : null) ??
    (scope.selector ? queryOne(doc, scope.selector) : null)
  );
}

function findSelectedElement(
  doc: Document,
  element: NonNullable<TweakSelectionTarget["element"]>,
): Element | null {
  const byId = findByNodeIds(doc, elementNodeIds(element));
  if (byId) return byId;
  for (const selector of elementSelectors(element)) {
    const found = queryOne(doc, selector);
    if (found) return found;
  }
  return null;
}

function scopeMatches(
  scope: TweakScope,
  ids: readonly (string | undefined)[],
  selectors: readonly (string | undefined)[],
): boolean {
  return (
    (!!scope.nodeId && ids.includes(scope.nodeId)) ||
    (!!scope.selector && selectors.includes(scope.selector))
  );
}

/**
 * True when the selection is the tweak's element, one of its ancestors, or one
 * of its descendants. A sibling never matches: its knobs drive another element.
 */
export function tweakAppliesToSelection(
  tweak: TweakDefinition,
  target: TweakSelectionTarget,
  parsedScreen: Document | null,
): boolean {
  const scopes = tweakScopes(tweak);
  if (scopes.length === 0) return true;
  return scopes.some((scope) =>
    scopeAppliesToSelection(scope, target, parsedScreen),
  );
}

function tweakScopes(tweak: TweakDefinition): TweakScope[] {
  if (!tweak.scope) return [];
  return Array.isArray(tweak.scope) ? tweak.scope : [tweak.scope];
}

function scopeAppliesToSelection(
  scope: TweakScope,
  target: TweakSelectionTarget,
  parsedScreen: Document | null,
): boolean {
  if (scope.screenId && scope.screenId !== target.screenId) return false;
  if (!scope.nodeId && !scope.selector) return true;
  const element = target.element;
  if (!element) {
    // A screen selection shows the tweaks that screen owns. Without a screen
    // id in the scope, the target must be found on this screen; a URL-backed
    // screen has no document to check, so the scope must name its screen.
    if (scope.screenId) return true;
    return !!parsedScreen && findScopeElement(parsedScreen, scope) !== null;
  }

  if (scopeMatches(scope, elementNodeIds(element), elementSelectors(element))) {
    return true;
  }

  if (parsedScreen) {
    const scopeElement = findScopeElement(parsedScreen, scope);
    const selectedElement = findSelectedElement(parsedScreen, element);
    if (scopeElement && selectedElement) {
      return (
        scopeElement.contains(selectedElement) ||
        selectedElement.contains(scopeElement)
      );
    }
  }

  // URL-backed screens have no document here; one hop is all the bridge reports.
  const parent = element.parentAutoLayout;
  if (parent && scopeMatches(scope, [parent.sourceId], [parent.selector])) {
    return true;
  }
  return (
    !!scope.nodeId &&
    (element.childLayouts?.children ?? []).some(
      (child) => child.nodeId === scope.nodeId,
    )
  );
}

export function parseScreenDocument(html: string | undefined): Document | null {
  if (!html || typeof DOMParser === "undefined") return null;
  return new DOMParser().parseFromString(html, "text/html");
}

export function tweaksForSelection(
  tweaks: readonly TweakDefinition[],
  targets: readonly TweakSelectionTarget[],
  screenHtmlById: (screenId: string) => string | undefined,
): TweakDefinition[] {
  if (tweaks.length === 0 || targets.length === 0) return [];
  const parsedByScreen = new Map<string, Document | null>();
  const parsed = (screenId: string) => {
    if (!parsedByScreen.has(screenId)) {
      parsedByScreen.set(
        screenId,
        parseScreenDocument(screenHtmlById(screenId)),
      );
    }
    return parsedByScreen.get(screenId) ?? null;
  };
  return tweaks.filter((tweak) =>
    targets.some((target) =>
      tweakAppliesToSelection(
        tweak,
        target,
        tweakScopes(tweak).some((scope) => scope.nodeId || scope.selector)
          ? parsed(target.screenId)
          : null,
      ),
    ),
  );
}
