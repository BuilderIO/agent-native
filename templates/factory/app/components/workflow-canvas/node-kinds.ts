import {
  IconArrowsSplit,
  IconArrowsSplit2,
  IconClockPlay,
  IconFilter,
  IconFlagCheck,
  IconHourglass,
  IconInbox,
  IconMessageCircle,
  IconSearch,
  IconSend,
  IconStack2,
  IconSubtask,
  type Icon,
} from "@tabler/icons-react";

import type { NodeKind, WorkflowNode } from "@/lib/workflow-editor";

import { providerIdentity } from "./provider-identity";

export const NODE_KIND_ICONS: Record<NodeKind, Icon> = {
  trigger: IconClockPlay,
  source: IconInbox,
  lookup: IconSearch,
  action: IconSend,
  filter: IconFilter,
  switch: IconArrowsSplit2,
  combine: IconStack2,
  split: IconArrowsSplit,
  ai: IconMessageCircle,
  agent: IconSubtask,
  wait: IconHourglass,
  end: IconFlagCheck,
};

/** AI and agent steps share one accent; every other kind sits on the neutral tile. */
export function kindTile(kind: NodeKind): string {
  return kind === "ai" || kind === "agent"
    ? "bg-accent-ai/15 text-accent-ai"
    : "bg-muted text-foreground";
}

/**
 * The integration a step calls, or null for a step that only works on data
 * inside Factory. Operation ids are `<provider>.<operation>`, such as
 * `hubspot.newLeads`.
 */
export function nodeProvider(node: WorkflowNode): string | null {
  switch (node.kind) {
    case "source":
      switch (node.settings.source) {
        case "inbox-poll":
          return node.settings.poller;
        case "status":
          return null;
        default:
          return operationProvider(node.settings.operation);
      }
    case "lookup":
    case "action":
      return operationProvider(node.settings.operation);
    default:
      return null;
  }
}

function operationProvider(operation: string): string {
  return operation.split(".")[0];
}

export function providerName(provider: string): string {
  return providerIdentity(provider).label;
}
