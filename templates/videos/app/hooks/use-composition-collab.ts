/**
 * Bridge between the videos composition state and the collaborative editing layer.
 *
 * Uses the core `useCollaborativeDoc` hook to sync composition data (tracks,
 * props, settings) across multiple users and the AI agent via Yjs CRDT.
 *
 * This follows "Option A": localStorage remains the primary state store.
 * Collab acts as a secondary sync layer — local edits are pushed to the
 * collab endpoint, and remote edits received via polling are applied back
 * to the local state.
 */

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  useCollaborativeDoc,
  emailToColor,
  emailToName,
  type CollabUser,
  type UseCollaborativeDocResult,
} from "@agent-native/core/client";
import { useSession } from "@agent-native/core/client";

const TAB_ID = `videos-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export { TAB_ID };

export interface CompositionCollabData {
  tracks?: any[];
  props?: Record<string, any>;
  settings?: {
    durationInFrames?: number;
    fps?: number;
    width?: number;
    height?: number;
  };
  updatedAt?: string;
}

export interface UseCompositionCollabResult {
  /** The parsed composition data from the collab layer, or null if not synced yet. */
  compositionData: CompositionCollabData | null;
  /** The raw Yjs document, for awareness state broadcasting. */
  ydoc: UseCollaborativeDocResult["ydoc"];
  /** Yjs awareness instance for cursor/presence sync. */
  awareness: UseCollaborativeDocResult["awareness"];
  /** Whether the initial collab state is still loading. */
  isLoading: boolean;
  /** Whether the collab doc is synced with the server. */
  isSynced: boolean;
  /** Active users collaborating on this composition. */
  activeUsers: CollabUser[];
  /** True briefly when the AI agent makes an edit. */
  agentActive: boolean;
  /** True when the AI agent has an active awareness entry. */
  agentPresent: boolean;
  /** Push local composition data to the collab layer. */
  pushToCollab: (data: CompositionCollabData) => void;
  /** The current user info (for awareness). */
  currentUser: CollabUser | undefined;
  /** Unique tab identifier for jitter prevention. */
  tabId: string;
}

/**
 * Hook that bridges composition state management with collaborative editing.
 *
 * @param compositionId - The composition ID, or null to disable collab.
 */
export function useCompositionCollab(
  compositionId: string | null,
): UseCompositionCollabResult {
  const { session } = useSession();

  // Build a stable user identity from the session
  const currentUser = useMemo<CollabUser | undefined>(() => {
    if (!session?.email) return undefined;
    return {
      name: emailToName(session.email),
      email: session.email,
      color: emailToColor(session.email),
    };
  }, [session?.email]);

  const docId = compositionId ? `comp-${compositionId}` : null;

  const {
    ydoc,
    awareness,
    isLoading,
    isSynced,
    activeUsers,
    agentActive,
    agentPresent,
  } = useCollaborativeDoc({
    docId,
    user: currentUser,
    requestSource: TAB_ID,
    pollInterval: 2000,
  });

  const [compositionData, setCompositionData] =
    useState<CompositionCollabData | null>(null);

  // When the Yjs doc syncs, read the Y.Text("content") and parse it
  useEffect(() => {
    if (!ydoc || !isSynced) return;

    const ytext = ydoc.getText("content");
    const text = ytext.toString();

    if (text) {
      try {
        const parsed = JSON.parse(text) as CompositionCollabData;
        setCompositionData(parsed);
      } catch {
        // Not valid JSON yet — initial state may be empty
      }
    }

    // Observe Y.Text changes from remote edits
    const observer = () => {
      const updated = ytext.toString();
      if (updated) {
        try {
          const parsed = JSON.parse(updated) as CompositionCollabData;
          setCompositionData(parsed);
        } catch {
          // Ignore parse errors during partial updates
        }
      }
    };

    ytext.observe(observer);
    return () => {
      ytext.unobserve(observer);
    };
  }, [ydoc, isSynced]);

  // Track whether we're currently pushing to avoid feedback loops
  const isPushingRef = useRef(false);

  // Push local state to collab endpoint, merging with existing state
  const pushToCollab = useCallback(
    (data: CompositionCollabData) => {
      if (!docId || isPushingRef.current) return;
      isPushingRef.current = true;

      const merged = { ...compositionData, ...data };
      const dataStr = JSON.stringify({
        ...merged,
        updatedAt: new Date().toISOString(),
      });

      fetch(`/_agent-native/collab/${docId}/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: dataStr,
          field: "content",
          requestSource: TAB_ID,
        }),
      })
        .catch(() => {
          // Collab sync failed — localStorage still has the data
        })
        .finally(() => {
          isPushingRef.current = false;
        });
    },
    [docId],
  );

  return {
    compositionData,
    ydoc,
    awareness,
    isLoading,
    isSynced,
    activeUsers,
    agentActive,
    agentPresent,
    pushToCollab,
    currentUser,
    tabId: TAB_ID,
  };
}
