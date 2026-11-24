import { useEffect, useRef } from "react";

import { resolveAppBasePath } from "./api-path.js";
import { getFrameOrigin, isKnownFrameHostOrigin } from "./frame.js";
import { updateMcpAppModelContext } from "./mcp-app-host.js";

export const SCREEN_SETTLED_EVENT = "agent-native:screen-settled";
export const UPDATE_MODEL_CONTEXT_MESSAGE_TYPE = "ui/update-model-context";

export interface RenderedScreenReport {
  screenId: string;
  entityType?: string;
  entityId?: string;
  objectTitle?: string;
  interactiveControls: readonly string[];
  isFallback?: boolean;
}

export interface UserInteractionReport {
  entityId: string;
  entityType?: string;
  action: string;
}

export interface LastUserInteractedEntity {
  entityId: string;
  entityType?: string;
  action: string;
  updatedAt: number;
}

export interface ScreenSettledReceipt {
  type: typeof SCREEN_SETTLED_EVENT;
  writeId: string;
  tabId: string;
  appBasePath: string;
  url: string;
  screenSummary: { title: string; route: string };
  renderedScreen?: RenderedScreenReport;
  lastUserInteractedEntity?: LastUserInteractedEntity;
  lastUserInteractedEntityId?: string;
}

export interface ExpectedRenderedScreen {
  screenId?: string;
  entityId?: string;
  requiredControls?: readonly string[];
}

export type ScreenSettledVerificationResult =
  | { verified: true; renderedScreen: RenderedScreenReport }
  | {
      verified: false;
      reason:
        | "missing-rendered-screen"
        | "fallback-rendered"
        | "screen-mismatch"
        | "entity-mismatch"
        | "missing-controls";
      renderedScreen?: RenderedScreenReport;
      expectedScreenId?: string;
      actualScreenId?: string;
      expectedEntityId?: string;
      actualEntityId?: string;
      missingControls?: string[];
    };

const recentlySettled = new Set<string>();
let currentRenderedScreen: RenderedScreenReport | null = null;
let lastUserInteractedEntity: LastUserInteractedEntity | null = null;

function normalizeRenderedScreen(
  report: RenderedScreenReport,
): RenderedScreenReport {
  const screenId = report.screenId.trim();
  const controls = Array.from(
    new Set(
      report.interactiveControls
        .map((control) => control.trim())
        .filter(Boolean),
    ),
  );
  return {
    screenId,
    ...(report.entityType?.trim()
      ? { entityType: report.entityType.trim() }
      : {}),
    ...(report.entityId?.trim() ? { entityId: report.entityId.trim() } : {}),
    ...(report.objectTitle?.trim()
      ? { objectTitle: report.objectTitle.trim() }
      : {}),
    interactiveControls: controls,
    ...(report.isFallback === true ? { isFallback: true } : {}),
  };
}

function buildModelContextSnapshot(
  includeClearedRenderedScreen = false,
): Record<string, unknown> {
  return {
    ...(currentRenderedScreen
      ? { renderedScreen: currentRenderedScreen }
      : includeClearedRenderedScreen
        ? { renderedScreen: null }
        : {}),
    ...(lastUserInteractedEntity
      ? {
          lastUserInteractedEntity,
          lastUserInteractedEntityId: lastUserInteractedEntity.entityId,
        }
      : {}),
  };
}

function resolveParentFrameOrigin(): string | undefined {
  const fromFrame = getFrameOrigin();
  if (fromFrame) return fromFrame;
  const loc = (window as { location?: { origin?: string } }).location;
  return loc?.origin;
}

function publishModelContextUpdate(includeClearedRenderedScreen = false): void {
  if (typeof window === "undefined") return;
  const snapshot = buildModelContextSnapshot(includeClearedRenderedScreen);
  if (Object.keys(snapshot).length === 0) return;

  try {
    const maybePromise = updateMcpAppModelContext({
      structuredContent: snapshot,
    });
    if (maybePromise && typeof maybePromise.catch === "function") {
      void maybePromise.catch(() => {});
    }
  } catch {
    // coercion-ok: standalone pages without an MCP host bridge skip RPC updates.
  }

  const parentOrigin = resolveParentFrameOrigin();
  if (
    window.parent !== window &&
    parentOrigin &&
    isKnownFrameHostOrigin(parentOrigin)
  ) {
    try {
      window.parent.postMessage(
        {
          type: UPDATE_MODEL_CONTEXT_MESSAGE_TYPE,
          ...snapshot,
        },
        parentOrigin,
      );
    } catch {
      // coercion-ok: best-effort postMessage to host frame.
    }
  }
}

/** Returns the latest rendered-screen report recorded in this tab, if any. */
export function getCurrentRenderedScreen(): RenderedScreenReport | null {
  return currentRenderedScreen;
}

/** Returns the most recent user interaction recorded in this tab, if any. */
export function getLastUserInteractedEntity(): LastUserInteractedEntity | null {
  return lastUserInteractedEntity;
}

/** Returns the entity ID from the most recent user interaction in this tab, if any. */
export function getLastUserInteractedEntityId(): string | null {
  return lastUserInteractedEntity?.entityId ?? null;
}

/** Records the currently mounted screen/object and publishes it to the host model context. */
export function reportRenderedScreen(
  report: RenderedScreenReport | null,
): RenderedScreenReport | null {
  if (report === null) {
    const hadScreen = currentRenderedScreen !== null;
    currentRenderedScreen = null;
    if (hadScreen) {
      publishModelContextUpdate(true);
    }
    return null;
  }
  const normalized = normalizeRenderedScreen(report);
  currentRenderedScreen = normalized;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("agent-native:rendered-screen", { detail: normalized }),
    );
  }
  publishModelContextUpdate();
  return normalized;
}

/** React hook for views to report their mounted screen, entity, and interactive controls to the host. */
export function useReportRenderedScreen(
  report: RenderedScreenReport | null,
): void {
  const normalized = report ? normalizeRenderedScreen(report) : null;
  const signature = normalized ? JSON.stringify(normalized) : null;
  const latestNormalizedRef = useRef<RenderedScreenReport | null>(normalized);
  latestNormalizedRef.current = normalized;
  const lastReportedRef = useRef<RenderedScreenReport | null>(null);

  useEffect(() => {
    const next = latestNormalizedRef.current;
    if (!signature || !next) {
      if (
        lastReportedRef.current &&
        currentRenderedScreen === lastReportedRef.current
      ) {
        currentRenderedScreen = null;
      }
      lastReportedRef.current = null;
      return;
    }
    const recorded = reportRenderedScreen(next);
    lastReportedRef.current = recorded;
    return () => {
      if (recorded && currentRenderedScreen === recorded) {
        currentRenderedScreen = null;
      }
    };
  }, [signature]);
}

/** Records a user interaction (click, drag, select) so follow-up references like "that one" resolve immediately. */
export function reportUserInteraction(
  interaction: UserInteractionReport,
): LastUserInteractedEntity {
  const recorded: LastUserInteractedEntity = {
    entityId: interaction.entityId.trim(),
    ...(interaction.entityType?.trim()
      ? { entityType: interaction.entityType.trim() }
      : {}),
    action: interaction.action.trim(),
    updatedAt: Date.now(),
  };
  lastUserInteractedEntity = recorded;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("agent-native:user-interaction", { detail: recorded }),
    );
  }
  publishModelContextUpdate();
  return recorded;
}

/** Verifies that a settled screen receipt actually mounted the requested screen, entity, and usable controls. */
export function verifyScreenSettledReceipt(
  receipt: ScreenSettledReceipt,
  expected: ExpectedRenderedScreen = {},
): ScreenSettledVerificationResult {
  const rendered = receipt.renderedScreen;
  if (!rendered) {
    return { verified: false, reason: "missing-rendered-screen" };
  }
  if (rendered.isFallback === true) {
    return {
      verified: false,
      reason: "fallback-rendered",
      renderedScreen: rendered,
    };
  }
  if (expected.screenId && rendered.screenId !== expected.screenId) {
    return {
      verified: false,
      reason: "screen-mismatch",
      renderedScreen: rendered,
      expectedScreenId: expected.screenId,
      actualScreenId: rendered.screenId,
    };
  }
  if (expected.entityId && rendered.entityId !== expected.entityId) {
    return {
      verified: false,
      reason: "entity-mismatch",
      renderedScreen: rendered,
      expectedEntityId: expected.entityId,
      ...(rendered.entityId !== undefined
        ? { actualEntityId: rendered.entityId }
        : {}),
    };
  }
  if (expected.requiredControls && expected.requiredControls.length > 0) {
    const present = new Set(rendered.interactiveControls);
    const missingControls = expected.requiredControls.filter(
      (control) => !present.has(control),
    );
    if (missingControls.length > 0) {
      return {
        verified: false,
        reason: "missing-controls",
        renderedScreen: rendered,
        missingControls,
      };
    }
  }
  return { verified: true, renderedScreen: rendered };
}

/** Resets rendered-screen and interaction state between unit tests. */
export function _resetRenderedScreenStateForTests(): void {
  recentlySettled.clear();
  currentRenderedScreen = null;
  lastUserInteractedEntity = null;
}

export function postScreenSettled({
  writeId,
  url,
  tabId,
  renderedScreen,
  lastUserInteractedEntity: explicitInteraction,
}: {
  writeId: string;
  url: string;
  tabId: string;
  renderedScreen?: RenderedScreenReport;
  lastUserInteractedEntity?: LastUserInteractedEntity;
}): void {
  const key = `${tabId}:${writeId}`;
  if (recentlySettled.has(key)) return;
  recentlySettled.add(key);
  if (recentlySettled.size > 256) {
    const oldest = recentlySettled.values().next();
    if (!oldest.done) recentlySettled.delete(oldest.value);
  }
  const safeUrl = new URL(url, "https://app.invalid");
  safeUrl.searchParams.delete("__an_embed_token");
  const route = safeUrl.pathname + safeUrl.search + safeUrl.hash;
  const effectiveRenderedScreen = renderedScreen
    ? normalizeRenderedScreen(renderedScreen)
    : (currentRenderedScreen ?? undefined);
  const effectiveInteraction =
    explicitInteraction ?? lastUserInteractedEntity ?? undefined;
  const detail: ScreenSettledReceipt = {
    type: SCREEN_SETTLED_EVENT,
    writeId,
    tabId,
    appBasePath: resolveAppBasePath(),
    url: route,
    screenSummary: { title: document.title, route },
    ...(effectiveRenderedScreen
      ? { renderedScreen: effectiveRenderedScreen }
      : {}),
    ...(effectiveInteraction
      ? {
          lastUserInteractedEntity: effectiveInteraction,
          lastUserInteractedEntityId: effectiveInteraction.entityId,
        }
      : {}),
  };
  window.dispatchEvent(new CustomEvent(SCREEN_SETTLED_EVENT, { detail }));
  const parentOrigin = resolveParentFrameOrigin();
  if (
    window.parent !== window &&
    parentOrigin &&
    isKnownFrameHostOrigin(parentOrigin)
  ) {
    window.parent.postMessage(detail, parentOrigin);
  }
}
