import type { AtRule, Container, Root } from "postcss";
import parseCss from "postcss/lib/parse";

import {
  extractManagedBreakpointCss,
  injectManagedBreakpointCss,
} from "../../shared/breakpoint-media.js";

const MEDIA_PARAMS_RE = /^\s*\(\s*max-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)\s*$/i;

type ResolvedMediaRule = {
  source: number;
  target: number;
};

/**
 * Rewrites only the numeric bounds in the managed stylesheet's media AST.
 * PostCSS keeps declarations, comments, unknown selectors, and nested
 * at-rules intact. A null result is a safe refusal when the stylesheet cannot
 * be parsed or two scopes would collapse into one.
 */
export function migrateBreakpointMediaBounds(
  html: string,
  boundMap: ReadonlyMap<number, number | null>,
): string | null {
  const css = extractManagedBreakpointCss(html);
  if (css === null || boundMap.size === 0) return html;

  let root: Root;
  try {
    const parsed = parseCss(css, { map: false });
    if (parsed.type !== "root") return null;
    root = parsed;
  } catch {
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
  if (!changed) return html;

  for (const [rule, { source, target }] of resolved) {
    if (source === target) continue;
    const match = MEDIA_PARAMS_RE.exec(rule.params);
    if (match) rule.params = rule.params.replace(match[1], String(target));
  }

  // The desktop-down cascade relies on wider media scopes appearing first.
  // Reorder only matching media nodes within their existing parent; all other
  // nodes stay in place with their original raw children and context.
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

  return injectManagedBreakpointCss(html, root.toString());
}
