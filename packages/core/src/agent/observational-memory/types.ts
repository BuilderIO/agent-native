/**
 * Shared types for Observational Memory (OM).
 *
 * Kept in their own module (no DB / engine imports) so both the store and the
 * compactor — and any future read-side consumer in production-agent — can
 * depend on them without pulling in a runtime.
 */

import type { EngineMessage } from "../engine/types.js";

/** The two compaction tiers. */
export type ObservationalMemoryTier = "observation" | "reflection";

/** One persisted OM entry (an observation or a reflection). */
export interface ObservationalMemoryEntry {
  id: string;
  threadId: string;
  tier: ObservationalMemoryTier;
  /** Dated, compacted text. */
  text: string;
  /** Estimated tokens for `text`. */
  tokenEstimate: number;
  /** Inclusive source range this entry summarizes (null when unknown). */
  sourceStartIndex: number | null;
  sourceEndIndex: number | null;
  /** Count of source messages/observations folded into this entry. */
  sourceMessageCount: number;
  createdAt: number;
  updatedAt: number;
  ownerEmail: string;
  orgId: string | null;
  visibility: "private" | "org" | "public";
}

/** Owner scoping common to every OM read/write. */
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
  /** Higher-level reflections, oldest → newest. */
  reflections: ObservationalMemoryEntry[];
  /** Dense observations, oldest → newest. */
  observations: ObservationalMemoryEntry[];
  /** The tail of raw thread messages kept verbatim (most recent turns). */
  recentMessages: EngineMessage[];
  /** Token accounting so the caller can reason about prompt budget. */
  tokens: {
    reflections: number;
    observations: number;
    recentMessages: number;
    total: number;
  };
}
