export function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

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

export interface AgentSelectionDescriptor {
  selector: string;
  label?: string;
}

export function agentSelectionDescriptor(
  target: { nodeId?: string | null; selector?: string | null },
  label?: string,
): AgentSelectionDescriptor | null {
  const selector = targetSelector(target);
  if (!selector) return null;
  return label ? { selector, label } : { selector };
}
