import { parse as parseHtml } from "parse5";
import type { AtRule, Container, Root } from "postcss";
import parseCss from "postcss/lib/parse";

import {
  extractManagedBreakpointCss,
  injectManagedBreakpointCss,
} from "../../shared/breakpoint-media.js";
import { migrateMaxWidthClassBoundsInHtml } from "../../shared/code-layer.js";
import {
  extractManagedResponsiveInteractionStateCss,
  injectManagedResponsiveInteractionStateCss,
} from "../../shared/interaction-states.js";

const MEDIA_PARAMS_RE = /^\s*\(\s*max-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)\s*$/i;
const EXACT_RANGE_ATTR = "data-agent-native-breakpoint-range";
const EXACT_RANGE_MAX_WIDTH_RE =
  /(\(\s*max-width\s*:\s*)(\d+(?:\.\d+)?)(\s*px\s*\))/gi;
const EXACT_RANGE_MIN_WIDTH_RE =
  /(\(\s*min-width\s*:\s*)(\d+(?:\.\d+)?)(\s*px\s*\))/gi;

type ResolvedMediaRule = {
  source: number;
  target: number;
};

export function migrateBreakpointMediaBounds(
  html: string,
  boundMap: ReadonlyMap<number, number | null>,
  options: { widthMap?: ReadonlyMap<number, number | null> } = {},
): string | null {
  const withMigratedClasses = migrateMaxWidthClassBoundsInHtml(html, boundMap);
  if (withMigratedClasses === null) return null;
  let migratedHtml = withMigratedClasses;

  const css = extractManagedBreakpointCss(migratedHtml);
  if (css === null) {
    if (hasManagedStyleMarker(migratedHtml, "data-agent-native-breakpoints")) {
      return null;
    }
  } else {
    const migratedCss = migrateMediaCssBounds(css, boundMap);
    if (migratedCss === null) return null;
    if (migratedCss !== css) {
      migratedHtml = injectManagedBreakpointCss(migratedHtml, migratedCss);
    }
  }

  const interactionCss =
    extractManagedResponsiveInteractionStateCss(migratedHtml);
  if (interactionCss === null) {
    if (
      hasManagedStyleMarker(migratedHtml, "data-agent-native-state-breakpoints")
    ) {
      return null;
    }
  } else {
    const migratedInteractionCss = migrateMediaCssBounds(
      interactionCss,
      boundMap,
    );
    if (migratedInteractionCss === null) return null;
    if (migratedInteractionCss !== interactionCss) {
      migratedHtml = injectManagedResponsiveInteractionStateCss(
        migratedHtml,
        migratedInteractionCss,
      );
    }
  }

  return migrateExactBreakpointRanges(
    migratedHtml,
    boundMap,
    options.widthMap ?? new Map(),
  );
}

function migrateMediaCssBounds(
  css: string,
  boundMap: ReadonlyMap<number, number | null>,
): string | null {
  if (boundMap.size === 0) return css;
  let root: Root;
  try {
    const parsed = parseCss(css, { map: false });
    if (parsed.type !== "root") return null;
    root = parsed;
  } catch {
    // coercion-ok: callers treat null as a typed refusal and fail closed on invalid CSS.
    return null;
  }

  const resolved = new Map<AtRule, ResolvedMediaRule>();
  const targetOwners = new Map<Container, Map<number, number>>();
  let changed = false;
  let refused = false;

  root.walkAtRules(/^media$/i, (rule) => {
    const match = MEDIA_PARAMS_RE.exec(rule.params);
    if (!match) return;
    const source = Math.round(Number.parseFloat(match[1]));
    const requestedTarget = boundMap.has(source)
      ? boundMap.get(source)!
      : source;
    if (
      requestedTarget === null ||
      !Number.isFinite(requestedTarget) ||
      requestedTarget <= 0
    ) {
      refused = true;
      return;
    }

    const target = Math.round(requestedTarget);
    const parent = rule.parent;
    if (!parent) {
      refused = true;
      return;
    }
    const owners = targetOwners.get(parent) ?? new Map<number, number>();
    const owner = owners.get(target);
    if (owner !== undefined && owner !== source) {
      refused = true;
      return;
    }
    owners.set(target, source);
    targetOwners.set(parent, owners);
    resolved.set(rule, { source, target });
    changed ||= target !== source;
  });

  if (refused) return null;
  if (!changed) return css;

  for (const [rule, { source, target }] of resolved) {
    if (source === target) continue;
    const match = MEDIA_PARAMS_RE.exec(rule.params);
    if (match) rule.params = rule.params.replace(match[1], String(target));
  }

  for (const parent of targetOwners.keys()) {
    const nodes = parent.nodes ?? [];
    const positions: number[] = [];
    const mediaRules: AtRule[] = [];
    nodes.forEach((node, index) => {
      if (node.type !== "atrule" || node.name.toLowerCase() !== "media") {
        return;
      }
      const match = MEDIA_PARAMS_RE.exec(node.params);
      if (!match) return;
      if (!resolved.has(node)) return;
      positions.push(index);
      mediaRules.push(node);
    });
    if (positions.length < 2) continue;
    mediaRules.sort(
      (a, b) => resolved.get(b)!.target - resolved.get(a)!.target,
    );
    const reordered = nodes.slice();
    positions.forEach((position, index) => {
      reordered[position] = mediaRules[index]!;
    });
    parent.nodes = reordered;
  }

  return root.toString();
}

function hasManagedStyleMarker(html: string, attribute: string): boolean {
  return new RegExp(`<style\\b(?=[^>]*\\b${attribute}\\b)[^>]*>`, "i").test(
    html,
  );
}

type ExactRangeStyle = {
  openStart: number;
  openEnd: number;
  closeStart: number;
  marker: string;
  body: string;
};

type HtmlNode = {
  nodeName?: string;
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
  content?: { childNodes?: HtmlNode[] };
  sourceCodeLocation?: {
    startTag?: { startOffset: number; endOffset: number };
    endTag?: { startOffset: number; endOffset: number };
  } | null;
};

type ExactRangeStyles = {
  entries: ExactRangeStyle[];
  hasMarker: boolean;
};

function findExactRangeStyles(html: string): ExactRangeStyles {
  const entries: ExactRangeStyle[] = [];
  let hasMarker = false;
  const visit = (node: HtmlNode): void => {
    if (node.tagName?.toLowerCase() === "style") {
      const marker = node.attrs?.find(
        (attribute) => attribute.name.toLowerCase() === EXACT_RANGE_ATTR,
      )?.value;
      if (marker !== undefined) {
        hasMarker = true;
        const location = node.sourceCodeLocation;
        const startTag = location?.startTag;
        const endTag = location?.endTag;
        if (startTag && endTag) {
          entries.push({
            openStart: startTag.startOffset,
            openEnd: startTag.endOffset,
            closeStart: endTag.startOffset,
            marker,
            body: html.slice(startTag.endOffset, endTag.startOffset),
          });
        }
      }
    }
    for (const child of [
      ...(node.childNodes ?? []),
      ...(node.content?.childNodes ?? []),
    ]) {
      visit(child);
    }
  };
  visit(
    parseHtml(html, { sourceCodeLocationInfo: true }) as unknown as HtmlNode,
  );
  return { entries, hasMarker };
}

type ExactRangeBoundResolution = {
  source: number;
  requested: number | null | undefined;
  alreadyTarget: boolean;
};

function resolveExactRangeBound(
  current: number,
  map: ReadonlyMap<number, number | null>,
): ExactRangeBoundResolution {
  if (map.has(current)) {
    return {
      source: current,
      requested: map.get(current),
      alreadyTarget: false,
    };
  }

  const reverseMatches = [...map.entries()].filter(
    ([source, target]) =>
      source !== current &&
      target !== null &&
      Number.isFinite(target) &&
      Math.round(target) === current,
  );
  if (reverseMatches.length === 1) {
    return {
      source: reverseMatches[0]![0],
      requested: current,
      alreadyTarget: true,
    };
  }

  return { source: current, requested: undefined, alreadyTarget: false };
}

function migrateExactBreakpointRanges(
  html: string,
  boundMap: ReadonlyMap<number, number | null>,
  widthMap: ReadonlyMap<number, number | null>,
): string | null {
  if (boundMap.size === 0 && widthMap.size === 0) return html;

  const { entries, hasMarker } = findExactRangeStyles(html);

  if (entries.length === 0 && hasMarker) {
    return null;
  }
  if (entries.length === 0) return html;

  const targetOwners = new Map<string, string>();
  const updates: Array<{
    entry: ExactRangeStyle;
    marker: string;
    body: string;
  }> = [];

  for (const entry of entries) {
    try {
      const parsed = parseCss(entry.body, { map: false });
      if (parsed.type !== "root") return null;
    } catch {
      // coercion-ok: callers treat null as a typed refusal and fail closed on invalid CSS.
      return null;
    }

    const separator = entry.marker.lastIndexOf("::");
    const bounds =
      separator > 0
        ? /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(
            entry.marker.slice(separator + 2),
          )
        : null;
    if (!bounds) return null;

    const currentMin = Math.round(Number.parseFloat(bounds[1]));
    const currentMax = Math.round(Number.parseFloat(bounds[2]));
    const minResolution = resolveExactRangeBound(currentMin, widthMap);
    const maxResolution = resolveExactRangeBound(currentMax, boundMap);
    const minMapped = minResolution.requested !== undefined;
    const maxMapped = maxResolution.requested !== undefined;
    if (minMapped !== maxMapped) return null;

    const alreadyTarget =
      minMapped &&
      maxMapped &&
      minResolution.requested === currentMin &&
      maxResolution.requested === currentMax &&
      (minResolution.alreadyTarget || maxResolution.alreadyTarget);

    let nextMin = currentMin;
    let nextMax = currentMax;
    if (minMapped && maxMapped) {
      const requestedMin = minResolution.requested!;
      const requestedMax = maxResolution.requested!;
      if (
        requestedMin === null ||
        requestedMax === null ||
        !Number.isFinite(requestedMin) ||
        !Number.isFinite(requestedMax) ||
        requestedMin <= 0 ||
        requestedMax <= 0
      ) {
        return null;
      }
      nextMin = alreadyTarget ? currentMin : Math.round(requestedMin);
      nextMax = alreadyTarget ? currentMax : Math.round(requestedMax);
      if (nextMin > nextMax) return null;
    }

    const nextMarker =
      entry.marker.slice(0, separator + 2) + `${nextMin}-${nextMax}`;
    const owner = targetOwners.get(nextMarker);
    if (owner !== undefined && owner !== entry.marker) return null;
    targetOwners.set(nextMarker, entry.marker);

    let nextBody = entry.body;
    if (minMapped && maxMapped) {
      const minMatches = [...entry.body.matchAll(EXACT_RANGE_MIN_WIDTH_RE)];
      const maxMatches = [...entry.body.matchAll(EXACT_RANGE_MAX_WIDTH_RE)];
      const expectedMin = alreadyTarget ? currentMin : minResolution.source;
      const expectedMax = alreadyTarget ? currentMax : maxResolution.source;
      if (
        maxMatches.length !== 1 ||
        Math.round(Number.parseFloat(maxMatches[0]![2])) !== expectedMax
      ) {
        return null;
      }
      if (
        minMatches.length > 1 ||
        (minMatches.length === 1 &&
          Math.round(Number.parseFloat(minMatches[0]![2])) !== expectedMin)
      ) {
        return null;
      }
      if (!alreadyTarget) {
        nextBody = entry.body.replace(
          EXACT_RANGE_MAX_WIDTH_RE,
          (_match, prefix: string, _value: string, suffix: string) =>
            `${prefix}${nextMax}${suffix}`,
        );
        if (minMatches.length === 1) {
          nextBody = nextBody.replace(
            EXACT_RANGE_MIN_WIDTH_RE,
            (_match, prefix: string, _value: string, suffix: string) =>
              `${prefix}${nextMin}${suffix}`,
          );
        }
      }
    }

    if (nextMarker !== entry.marker || nextBody !== entry.body) {
      updates.push({ entry, marker: nextMarker, body: nextBody });
    }
  }

  return applyExactRangeBodyUpdates(html, updates);
}

function applyExactRangeBodyUpdates(
  html: string,
  updates: Array<{ entry: ExactRangeStyle; marker: string; body: string }>,
): string | null {
  let migratedHtml = html;
  for (let index = updates.length - 1; index >= 0; index -= 1) {
    const update = updates[index]!;
    const openTag = migratedHtml.slice(
      update.entry.openStart,
      update.entry.openEnd,
    );
    const markerStart = openTag.indexOf(update.entry.marker);
    if (markerStart < 0) return null;
    const nextOpenTag =
      openTag.slice(0, markerStart) +
      update.marker +
      openTag.slice(markerStart + update.entry.marker.length);
    const bodyEnd = update.entry.closeStart;
    migratedHtml =
      migratedHtml.slice(0, update.entry.openStart) +
      nextOpenTag +
      update.body +
      migratedHtml.slice(bodyEnd);
  }
  return migratedHtml;
}
