/**
 * Component model — pure helpers for detecting and describing component
 * instances from code-layer node data.
 *
 * Two detection strategies:
 *
 * 1. **Alpine / annotated inline** — the design HTML carries
 *    `data-agent-native-component="Name"` attributes stamped directly on the
 *    DOM element that acts as the component root.  Optional sibling attributes
 *    `data-agent-native-prop-*` carry prop name/value pairs.
 *
 * 2. **Real-app (localhost / fusion)** — a Vite/Babel transform injects
 *    `data-agent-native-component` plus `data-agent-native-prop-*` at
 *    build time so instances are discoverable from the rendered HTML.  In
 *    addition, the `component_index` table holds richer metadata (TS prop
 *    types, cva variants, Storybook stories) indexed by `index-components`.
 *
 * This module is **pure** — no DB, no IO.  It operates on `CodeLayerNode`
 * objects returned by `buildCodeLayerProjection`.
 *
 * See DESIGN-STUDIO-PLAN.md §6.1 for context.
 */

import type { CodeLayerNode } from "./code-layer";

// ─── Component detection attributes ───────────────────────────────────────────

/** The HTML attribute that marks a DOM node as a component root. */
export const COMPONENT_NAME_ATTR = "data-agent-native-component";

/** Prefix for simple prop attributes stamped next to the component root. */
export const COMPONENT_PROP_PREFIX = "data-agent-native-prop-";

// ─── Extracted prop value ─────────────────────────────────────────────────────

export interface ComponentPropValue {
  /** Prop name derived from the attribute (e.g. `"variant"` from `data-agent-native-prop-variant`). */
  name: string;
  /** Raw attribute value string as found in the HTML. */
  value: string;
}

/**
 * Convert a JavaScript/React prop name to the `data-agent-native-prop-*`
 * attribute name used in rendered HTML.
 *
 * HTML attribute names are lower-cased by parsers, so camelCase must be written
 * as kebab-case to round-trip through {@link extractProps}.
 */
export function propNameToDataAttribute(propName: string): string {
  const suffix = propName
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
  return `${COMPONENT_PROP_PREFIX}${suffix}`;
}

// ─── Component instance ───────────────────────────────────────────────────────

/**
 * A component instance detected in the rendered HTML.
 *
 * For Alpine / annotated designs this is the authoritative shape.  For
 * real-app sources the `componentIndexId` ties back to the `component_index`
 * row, which carries prop types, variants, and Storybook stories.
 */
export interface ComponentInstance {
  /**
   * Stable instance id — the `data-agent-native-node-id` of the root node
   * (or the node's `id` field when the node id attribute is absent).
   */
  instanceId: string;

  /**
   * Component name as declared in `data-agent-native-component`.
   * E.g. `"PrimaryButton"`, `"HeroCard"`.
   */
  name: string;

  /**
   * Simple prop values extracted from `data-agent-native-prop-*` attributes.
   * Present on annotated Alpine nodes and on real-app nodes instrumented by
   * the Vite/Babel transform.
   */
  props: ComponentPropValue[];

  /**
   * The `x-data` Alpine expression on the node, when present.  Used by the
   * Alpine editor to show variant/state controls inline.
   */
  alpineData?: string;

  /**
   * CSS selector that uniquely addresses this instance on the canvas.
   * Derived from the node's primary selector.
   */
  selector: string;

  /**
   * The `data-agent-native-node-id` value (same as `instanceId` for annotated
   * nodes; provided separately so callers can pass it as a stable handle to
   * other code-layer APIs even when `instanceId` is constructed from a
   * different attribute).
   */
  nodeId: string;

  /**
   * `component_index.id` of the matching persisted component row, when
   * available.  Populated by `index-components` for real-app sources and used
   * by `get-component-details` to load prop types and variants.
   */
  componentIndexId?: string;
}

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Return `true` when the node carries a `data-agent-native-component`
 * annotation — i.e. it is the root of an Alpine or real-app component
 * instance.
 */
export function isComponentInstance(node: CodeLayerNode): boolean {
  return typeof node.dataAttributes[COMPONENT_NAME_ATTR] === "string";
}

/**
 * Return the component name declared on the node, or `null` when the node is
 * not a component root.
 */
export function componentNameFor(node: CodeLayerNode): string | null {
  const raw = node.dataAttributes[COMPONENT_NAME_ATTR];
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.trim();
}

/**
 * Match a selected component handle against both generated code-layer ids and
 * durable runtime/source ids stamped into the rendered DOM.
 */
export function componentNodeIdMatches(
  node: CodeLayerNode,
  nodeId: string,
): boolean {
  return (
    node.id === nodeId ||
    node.dataAttributes["data-agent-native-node-id"] === nodeId ||
    node.dataAttributes["data-code-layer-id"] === nodeId ||
    node.dataAttributes["data-layer-id"] === nodeId ||
    node.dataAttributes["data-builder-id"] === nodeId ||
    node.dataAttributes["data-loc"] === nodeId ||
    node.attributes.id === nodeId
  );
}

/**
 * Extract simple prop values from `data-agent-native-prop-*` attributes on a
 * code-layer node.
 *
 * The attribute names are lower-cased by the HTML parser so we convert
 * `data-agent-native-prop-variant` → `{ name: "variant", value: "..." }`.
 */
export function extractProps(node: CodeLayerNode): ComponentPropValue[] {
  const props: ComponentPropValue[] = [];
  for (const [attr, value] of Object.entries(node.dataAttributes)) {
    if (!attr.startsWith(COMPONENT_PROP_PREFIX)) continue;
    const rawName = attr.slice(COMPONENT_PROP_PREFIX.length);
    // Convert kebab-case attribute suffix to camelCase prop name.
    const name = rawName.replace(/-([a-z])/g, (_, c: string) =>
      c.toUpperCase(),
    );
    if (name) props.push({ name, value });
  }
  return props;
}

/**
 * Build a `ComponentInstance` from a `CodeLayerNode` that carries a
 * `data-agent-native-component` attribute.
 *
 * Returns `null` when the node is not a component root.
 */
export function instanceFromNode(
  node: CodeLayerNode,
  componentIndexId?: string,
): ComponentInstance | null {
  const name = componentNameFor(node);
  if (!name) return null;

  // `x-data` is stored as a plain attribute (not a data-* attribute) so we
  // look in `node.attributes` rather than `node.dataAttributes`.
  const alpineDataRaw = node.attributes["x-data"];
  const alpineData =
    typeof alpineDataRaw === "string" ? alpineDataRaw : undefined;

  return {
    instanceId: node.id,
    name,
    props: extractProps(node),
    alpineData,
    selector: node.selector,
    nodeId: node.id,
    componentIndexId,
  };
}

/**
 * Scan a flat list of `CodeLayerNode` objects and return all component
 * instances, preserving document order.
 *
 * Accepts an optional `indexMap` — a `Map<name, componentIndexId>` — which is
 * populated by `index-components` after writing to `component_index` and used
 * to correlate instances with their persisted metadata.
 */
export function detectInstances(
  nodes: CodeLayerNode[],
  indexMap?: Map<string, string>,
): ComponentInstance[] {
  const instances: ComponentInstance[] = [];
  for (const node of nodes) {
    if (!isComponentInstance(node)) continue;
    const name = componentNameFor(node);
    if (!name) continue;
    const componentIndexId = indexMap?.get(name);
    const instance = instanceFromNode(node, componentIndexId);
    if (instance) instances.push(instance);
  }
  return instances;
}

// ─── Unique component definitions ────────────────────────────────────────────

/**
 * A distinct component definition derived by collapsing all instances of the
 * same name into one entry.
 */
export interface ComponentDefinition {
  name: string;
  /** All instance node ids for this component. */
  instanceNodeIds: string[];
  /** Union of all prop names seen across all instances. */
  observedPropNames: string[];
}

/**
 * Collapse a flat list of `ComponentInstance` objects into one
 * `ComponentDefinition` per unique component name.
 */
export function buildDefinitions(
  instances: ComponentInstance[],
): ComponentDefinition[] {
  const map = new Map<
    string,
    { instanceNodeIds: string[]; propNames: Set<string> }
  >();

  for (const instance of instances) {
    let entry = map.get(instance.name);
    if (!entry) {
      entry = { instanceNodeIds: [], propNames: new Set() };
      map.set(instance.name, entry);
    }
    entry.instanceNodeIds.push(instance.nodeId);
    for (const prop of instance.props) {
      entry.propNames.add(prop.name);
    }
  }

  return Array.from(map.entries()).map(([name, entry]) => ({
    name,
    instanceNodeIds: entry.instanceNodeIds,
    observedPropNames: Array.from(entry.propNames),
  }));
}
