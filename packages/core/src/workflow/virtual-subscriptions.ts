import type { WorkflowEvent, WorkflowSubscriptionInput } from "./types.js";

export interface VirtualWorkflowSubscriptionSnapshot extends WorkflowSubscriptionInput {
  version: number;
}

export interface VirtualWorkflowSubscriptionProvider {
  id: string;
  evaluationStartSequence: number;
  subscriptionsForEvent(
    event: WorkflowEvent,
  ):
    | VirtualWorkflowSubscriptionSnapshot[]
    | Promise<VirtualWorkflowSubscriptionSnapshot[]>;
}

const REGISTRY = Symbol.for(
  "@agent-native/core/workflow.virtual-subscription-providers",
);

function providers(): Map<string, VirtualWorkflowSubscriptionProvider> {
  const global = globalThis as typeof globalThis & {
    [REGISTRY]?: Map<string, VirtualWorkflowSubscriptionProvider>;
  };
  if (!global[REGISTRY]) global[REGISTRY] = new Map();
  return global[REGISTRY];
}

export function registerVirtualWorkflowSubscriptionProvider(
  provider: VirtualWorkflowSubscriptionProvider,
): () => void {
  if (!provider.id.trim())
    throw new Error("Virtual workflow provider id is required");
  providers().set(provider.id, provider);
  return () => providers().delete(provider.id);
}

export function listVirtualWorkflowSubscriptionProviders(): VirtualWorkflowSubscriptionProvider[] {
  return [...providers().values()];
}

export function __resetVirtualWorkflowSubscriptionProviders(): void {
  providers().clear();
}
