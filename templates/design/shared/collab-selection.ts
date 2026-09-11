/**
 * Helpers for publishing resolvable agent selection descriptors into collab
 * awareness so live viewers can render a selection ring over the element the
 * agent is editing.
 *
 * The client (`RemoteSelectionRings`) resolves the descriptor's `selector`
 * against the active screen's iframe via `querySelector`. A selector built
 * from a stable `data-agent-native-node-id` is the most reliable anchor; a
 * projection-derived CSS selector is the fallback. The optional `label`
 * renders next to the ring (e.g. "AI — Editing button text").
 */

/** Escape a value for use inside a double-quoted CSS attribute selector. */
export function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Build a resolvable CSS selector for an edit target. Prefers the stable
 * `data-agent-native-node-id` attribute; falls back to a projection selector.
 * Returns `null` when neither is available.
 */
export function targetSelector(target: {
  nodeId?: string | null;
  selector?: string | null;
}): string | null {
  if (target.nodeId) {
    return `[data-agent-native-node-id="${escapeAttrValue(target.nodeId)}"]`;
  }
  if (target.selector) return target.selector;
  return null;
}

/** A selection descriptor consumed by `RemoteSelectionRings`. */
export interface AgentSelectionDescriptor {
  selector: string;
  label?: string;
}

/**
 * Build the `selection` awareness field for an edit target, or `null` when the
 * target can't be resolved to a selector. When non-null, viewers render a ring
 * labelled with `label` (kept short — a human-readable edit intent).
 */
export function agentSelectionDescriptor(
  target: { nodeId?: string | null; selector?: string | null },
  label?: string,
): AgentSelectionDescriptor | null {
  const selector = targetSelector(target);
  if (!selector) return null;
  return label ? { selector, label } : { selector };
}
