
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

/**
 * The three-tier context returned by `buildObservationalContext`, ready to be
 * folded into a prompt:
 *
 *   reflections (highest level)  +  observations (dense)  +  recent raw messages
 *
 * The caller decides exactly how to serialize these into the system prompt /
 * message list; OM only assembles the tiers and their token accounting.
 */
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
