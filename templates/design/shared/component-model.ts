
import type { CodeLayerNode, CodeLayerProjection } from "./code-layer";


export const COMPONENT_NAME_ATTR = "data-agent-native-component";

export const COMPONENT_ID_ATTR = "data-agent-native-component-id";

export const COMPONENT_REF_ATTR = "data-agent-native-component-ref";

export const COMPONENT_SOURCE_NODE_ID_ATTR =
  "data-agent-native-component-source-node-id";

export const COMPONENT_OVERRIDES_ATTR = "data-agent-native-component-overrides";

export const COMPONENT_PROP_PREFIX = "data-agent-native-prop-";

export function stableComponentNodeId(node: CodeLayerNode): string {
  return node.dataAttributes["data-agent-native-node-id"]?.trim() || node.id;
}

export function componentIndexId(designId: string, name: string): string {
  return `ci_${designId}_${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
}


export interface ComponentPropValue {
  name: string;
  value: string;
}

export function propNameToDataAttribute(propName: string): string {
  const suffix = propName
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
  return `${COMPONENT_PROP_PREFIX}${suffix}`;
}


export interface ComponentInstance {
  instanceId: string;

  name: string;

  props: ComponentPropValue[];

  alpineData?: string;

  selector: string;

  nodeId: string;

  componentIndexId?: string;

  componentId?: string;

  componentRef?: string;
}


export function isComponentInstance(node: CodeLayerNode): boolean {
  return typeof node.dataAttributes[COMPONENT_NAME_ATTR] === "string";
}

export function isComponentInstanceForInstanceActions(
  node: CodeLayerNode,
): boolean {
  if (!isComponentInstance(node)) return false;
  return !Object.prototype.hasOwnProperty.call(
    node.dataAttributes,
    COMPONENT_ID_ATTR,
  );
}

export function componentNameFor(node: CodeLayerNode): string | null {
  const raw = node.dataAttributes[COMPONENT_NAME_ATTR];
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.trim();
}

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

export function extractProps(node: CodeLayerNode): ComponentPropValue[] {
  const props: ComponentPropValue[] = [];
  for (const [attr, value] of Object.entries(node.dataAttributes)) {
    if (!attr.startsWith(COMPONENT_PROP_PREFIX)) continue;
    const rawName = attr.slice(COMPONENT_PROP_PREFIX.length);
    const name = rawName.replace(/-([a-z])/g, (_, c: string) =>
      c.toUpperCase(),
    );
    if (name) props.push({ name, value });
  }
  return props;
}

export function instanceFromNode(
  node: CodeLayerNode,
  componentIndexId?: string,
): ComponentInstance | null {
  const name = componentNameFor(node);
  if (!name) return null;

  const alpineDataRaw = node.attributes["x-data"];
  const alpineData =
    typeof alpineDataRaw === "string" ? alpineDataRaw : undefined;
  const stableNodeId = stableComponentNodeId(node);

  return {
    instanceId: stableNodeId,
    name,
    props: extractProps(node),
    alpineData,
    selector: node.selector,
    nodeId: stableNodeId,
    componentIndexId,
    componentId: node.dataAttributes[COMPONENT_ID_ATTR]?.trim() || undefined,
    componentRef: node.dataAttributes[COMPONENT_REF_ATTR]?.trim() || undefined,
  };
}

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


export interface ComponentDefinition {
  name: string;
  instanceNodeIds: string[];
  observedPropNames: string[];
}

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

export function linkedComponentRootForNode(
  node: CodeLayerNode,
  projection: CodeLayerProjection,
): CodeLayerNode | null {
  const nodesById = new Map(projection.nodes.map((entry) => [entry.id, entry]));
  let current: CodeLayerNode | undefined = node;
  while (current) {
    if (
      Object.prototype.hasOwnProperty.call(
        current.dataAttributes,
        COMPONENT_ID_ATTR,
      ) ||
      Object.prototype.hasOwnProperty.call(
        current.dataAttributes,
        COMPONENT_REF_ATTR,
      )
    )
      return current;
    current = current.parentId ? nodesById.get(current.parentId) : undefined;
  }
  return null;
}
