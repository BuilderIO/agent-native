import type { TweakDefinition } from "@shared/api";

import {
  parseScreenDocument,
  tweakAppliesToSelection,
} from "../edit-panel/tweak-scope";

const parsedDocuments = new Map<string, Document | null>();

function parsedScreenDocument(html: string | undefined): Document | null {
  if (!html) return null;
  if (!parsedDocuments.has(html)) {
    parsedDocuments.set(html, parseScreenDocument(html));
    if (parsedDocuments.size > 8)
      parsedDocuments.delete(parsedDocuments.keys().next().value!);
  }
  return parsedDocuments.get(html) ?? null;
}

export interface InteractTweakSet {
  tweakId: string;
  value: string | number | boolean;
}

/**
 * Resolves a `tweak-set` message an Interact frame posts when the user drags
 * an on-figure control. The frame names the tweak by `id` or `cssVar`; the
 * tweak must exist and be scoped to the frame's screen, and the value must be
 * one the inspector could have chosen. Anything else returns null.
 */
export function resolveInteractTweakSet(
  data: unknown,
  tweaks: readonly TweakDefinition[],
  screenId: string,
  screenHtml: string | undefined,
): InteractTweakSet | null {
  if (!data || typeof data !== "object") return null;
  const message = data as {
    type?: unknown;
    id?: unknown;
    cssVar?: unknown;
    value?: unknown;
  };
  if (message.type !== "tweak-set") return null;
  const tweak =
    typeof message.id === "string"
      ? tweaks.find((candidate) => candidate.id === message.id)
      : typeof message.cssVar === "string"
        ? tweaks.find((candidate) => candidate.cssVar === message.cssVar)
        : undefined;
  if (!tweak) return null;
  const scopes = Array.isArray(tweak.scope)
    ? tweak.scope
    : tweak.scope
      ? [tweak.scope]
      : [];
  const needsDocument = scopes.some((scope) => scope.nodeId || scope.selector);
  if (
    !tweakAppliesToSelection(
      tweak,
      { screenId },
      needsDocument ? parsedScreenDocument(screenHtml) : null,
    )
  ) {
    return null;
  }
  const value = coerceTweakValue(tweak, message.value);
  return value === null ? null : { tweakId: tweak.id, value };
}

function coerceTweakValue(
  tweak: TweakDefinition,
  raw: unknown,
): string | number | boolean | null {
  switch (tweak.type) {
    case "slider":
      return clampSliderValue(tweak, raw);
    case "toggle":
      if (typeof raw === "boolean") return raw;
      if (raw === "true" || raw === "1" || raw === 1) return true;
      if (raw === "false" || raw === "0" || raw === 0) return false;
      return null;
    case "segment":
    case "color-swatch":
    case "color-swatches":
      if (typeof raw !== "string") return null;
      return tweak.options?.some((option) => option.value === raw) ? raw : null;
  }
}

function clampSliderValue(tweak: TweakDefinition, raw: unknown): number | null {
  // A frame may post the CSS value it set, unit included ("66deg").
  const parsed =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseFloat(raw)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  let value = parsed;
  if (typeof tweak.min === "number") value = Math.max(tweak.min, value);
  if (typeof tweak.max === "number") value = Math.min(tweak.max, value);
  if (typeof tweak.step === "number" && tweak.step > 0) {
    const base = typeof tweak.min === "number" ? tweak.min : 0;
    value = base + Math.round((value - base) / tweak.step) * tweak.step;
    // Snapping can step past max when (max - min) is not a whole step count.
    if (typeof tweak.max === "number" && value > tweak.max) value -= tweak.step;
    const decimals = stepDecimals(tweak.step);
    value = Number(value.toFixed(decimals));
  }
  return value;
}

function stepDecimals(step: number): number {
  const text = String(step);
  const exponent = /e-(\d+)$/.exec(text);
  if (exponent) return Number(exponent[1]);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

/**
 * A window `message` listener that accepts `tweak-set` only from the given
 * frame's own window.
 */
export function createInteractTweakSetListener(options: {
  isInlineDocument: () => boolean;
  getFrameWindow: () => Window | null | undefined;
  getCapability: () => string | undefined;
  getTweaks: () => readonly TweakDefinition[];
  screenId: string;
  getScreenHtml: () => string | undefined;
  onTweakSet: (tweakId: string, value: string | number | boolean) => void;
}): (event: MessageEvent) => void {
  return (event) => {
    if (!options.isInlineDocument()) return;
    const frameWindow = options.getFrameWindow();
    if (!frameWindow || event.source !== frameWindow) return;
    const capability = options.getCapability();
    if (!capability) return;
    const resolved = resolveInteractTweakSet(
      event.data,
      options.getTweaks(),
      options.screenId,
      options.getScreenHtml(),
    );
    if (
      resolved &&
      event.data !== null &&
      typeof event.data === "object" &&
      (event.data as { capability?: unknown }).capability === capability
    ) {
      options.onTweakSet(resolved.tweakId, resolved.value);
    }
  };
}
