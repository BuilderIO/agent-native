import type { EngineMessage } from "../engine/types.js";

export type ObservationalMemoryTier = "observation" | "reflection";

export interface ObservationalMemoryEntry {
  id: string;
  threadId: string;
  tier: ObservationalMemoryTier;
  text: string;
  tokenEstimate: number;
  sourceStartIndex: number | null;
  sourceEndIndex: number | null;
  sourceMessageCount: number;
  createdAt: number;
  updatedAt: number;
  ownerEmail: string;
  orgId: string | null;
  visibility: "private" | "org" | "public";
}

export interface ObservationalMemoryOwner {
  ownerEmail: string;
  orgId?: string | null;
}

export interface ObservationalContext {
  threadId: string;
  reflections: ObservationalMemoryEntry[];
  observations: ObservationalMemoryEntry[];
  recentMessages: EngineMessage[];
  tokens: {
    reflections: number;
    observations: number;
    recentMessages: number;
    total: number;
  };
}
