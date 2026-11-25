import { useT3AgentRequestSync } from "@/hooks/use-t3-agents";

export function T3AgentRequestSync({ documentId }: { documentId: string }) {
  useT3AgentRequestSync(documentId);
  return null;
}
