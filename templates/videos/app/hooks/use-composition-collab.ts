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

import {
  agentNativePath,
  useCollaborativeDoc,
  emailToColor,
  emailToName,
  useSession,
  type CollabUser,
  type UseCollaborativeDocResult,
} from "@agent-native/core/client";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";

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

/**
 * Normalize a parsed composition JSON blob into the canonical collab shape the
 * contexts consume (`tracks`, `props`, `settings`).
 *
 * Two writers feed `Y.Text("content")` and historically disagreed on the field
 * names, which is why agent edits used to never reach the editor's props/settings:
 *
 *  - The agent actions (`update-composition`, `save-composition`) and the SQL
 *    source of truth (`compositions.data`, see `databaseRowToComposition`) use
 *    the FLAT, DB-canonical shape:
 *    `{ tracks, defaultProps, durationInFrames, fps, width, height }`.
 *  - The UI's own `pushToCollab` historically used a NESTED shape:
 *    `{ tracks, props, settings: { durationInFrames, fps, width, height } }`.
 *
 * `tracks` was the only field both shapes shared, so timeline edits synced but
 * prop/setting edits silently dropped. We now normalize on read so BOTH shapes
 * are understood, and `pushToCollab` writes the DB-canonical shape so every
 * writer (agent, SQL, and all clients) agrees.
 */
function normalizeCompositionCollab(raw: any): CompositionCollabData | null {
  if (!raw || typeof raw !== "object") return null;

  const tracks = Array.isArray(raw.tracks) ? raw.tracks : undefined;

  // props: prefer the DB-canonical `defaultProps`, fall back to nested `props`.
  const props =
    raw.defaultProps && typeof raw.defaultProps === "object"
      ? raw.defaultProps
      : raw.props && typeof raw.props === "object"
        ? raw.props
        : undefined;

  // settings: prefer the nested `settings` object, otherwise lift the flat
  // DB-canonical fields into a settings object.
  let settings: CompositionCollabData["settings"];
  if (raw.settings && typeof raw.settings === "object") {
    settings = raw.settings;
  } else {
    const flat: CompositionCollabData["settings"] = {};
    if (typeof raw.durationInFrames === "number")
      flat.durationInFrames = raw.durationInFrames;
    if (typeof raw.fps === "number") flat.fps = raw.fps;
    if (typeof raw.width === "number") flat.width = raw.width;
    if (typeof raw.height === "number") flat.height = raw.height;
    if (Object.keys(flat).length > 0) settings = flat;
  }

  return {
    tracks,
    props,
    settings,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
  };
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
        const parsed = normalizeCompositionCollab(JSON.parse(text));
        if (parsed) setCompositionData(parsed);
      } catch {
        // Not valid JSON yet — initial state may be empty
      }
    }

    // Observe Y.Text changes from remote edits (other users AND the agent —
    // the agent writes the DB-canonical JSON in-process via applyText).
    const observer = () => {
      const updated = ytext.toString();
      if (updated) {
        try {
          const parsed = normalizeCompositionCollab(JSON.parse(updated));
          if (parsed) setCompositionData(parsed);
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

  // Hold the latest parsed state so pushToCollab can merge against it without
  // depending on `compositionData` (which would change its identity on every
  // remote edit and re-trigger the contexts' push effects).
  const compositionDataRef = useRef<CompositionCollabData | null>(null);
  compositionDataRef.current = compositionData;

  // Push local state to collab endpoint, merging with existing state and
  // writing the DB-canonical shape so every writer (the agent's in-process
  // `applyText`, the SQL `compositions.data` column, and all clients) agree on
  // field names. `update-composition`/`save-composition` read `defaultProps`
  // and flat `durationInFrames`/`fps`/`width`/`height`, so we serialize the
  // same way here instead of the old nested `{ props, settings }` shape.
  const pushToCollab = useCallback(
    (data: CompositionCollabData) => {
      if (!docId || isPushingRef.current) return;
      isPushingRef.current = true;

      const current = compositionDataRef.current ?? {};
      const tracks = data.tracks ?? current.tracks;
      const props = data.props ?? current.props;
      const settings = data.settings ?? current.settings;

      const payload: Record<string, any> = {
        updatedAt: new Date().toISOString(),
      };
      if (tracks !== undefined) payload.tracks = tracks;
      if (props !== undefined) payload.defaultProps = props;
      if (settings) {
        if (typeof settings.durationInFrames === "number")
          payload.durationInFrames = settings.durationInFrames;
        if (typeof settings.fps === "number") payload.fps = settings.fps;
        if (typeof settings.width === "number") payload.width = settings.width;
        if (typeof settings.height === "number")
          payload.height = settings.height;
      }

      const dataStr = JSON.stringify(payload);

      fetch(agentNativePath(`/_agent-native/collab/${docId}/text`), {
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
