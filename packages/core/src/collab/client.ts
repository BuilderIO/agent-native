/**
 * Client-side hook for collaborative document editing via Yjs.
 *
 * Creates a STABLE Y.Doc per docId that never changes identity. This allows
 * TipTap's Collaboration extension to bind once without editor recreation.
 * Server state is applied to the existing doc when it arrives.
 *
 * Also manages Yjs Awareness for cursor positions and user presence,
 * synced via polling to the server's awareness endpoint.
 */

import { useEffect, useRef, useState, useMemo } from "react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";

export interface CollabUser {
  name: string;
  email: string;
  color: string;
}

export interface UseCollaborativeDocOptions {
  /** Document ID to collaborate on. Pass null to disable. */
  docId: string | null;
  /** Poll interval in ms. Default: 2000 */
  pollInterval?: number;
  /** Base URL for collab endpoints. Default: "/_agent-native/collab" */
  baseUrl?: string;
  /** Request source ID for jitter prevention (e.g., tab ID). */
  requestSource?: string;
  /** Current user info for cursor labels. */
  user?: CollabUser;
}

export interface UseCollaborativeDocResult {
  /** The Yjs document instance. Stable per docId — never changes identity. */
  ydoc: Y.Doc | null;
  /** Yjs Awareness instance for cursor/presence sync. */
  awareness: Awareness | null;
  /** Whether the initial state is still loading from the server. */
  isLoading: boolean;
  /** Whether the doc is synced with the server. */
  isSynced: boolean;
  /** Active users on this document (from awareness). */
  activeUsers: CollabUser[];
  /** True briefly when the AI agent makes an edit (for presence indicator). */
  agentActive: boolean;
  /** True when the AI agent has an active awareness entry (durable presence). */
  agentPresent: boolean;
}

// Consistent color palette for user cursors
const CURSOR_COLORS = [
  "#f87171",
  "#fb923c",
  "#fbbf24",
  "#a3e635",
  "#34d399",
  "#22d3ee",
  "#60a5fa",
  "#a78bfa",
  "#f472b6",
  "#e879f9",
];

/** Hash a string to a consistent color from the palette. */
export function emailToColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = ((hash << 5) - hash + email.charCodeAt(i)) | 0;
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

/** Derive a display name from an email address. */
export function emailToName(email: string): string {
  const local = email.split("@")[0] || email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

// Base64 helpers
function uint8ArrayToBase64(arr: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < arr.length; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    arr[i] = binary.charCodeAt(i);
  }
  return arr;
}

export function useCollaborativeDoc(
  options: UseCollaborativeDocOptions,
): UseCollaborativeDocResult {
  const {
    docId,
    pollInterval = 2000,
    baseUrl = "/_agent-native/collab",
    requestSource,
    user,
  } = options;

  // Stable Y.Doc per docId
  const ydoc = useMemo(() => {
    if (!docId) return null;
    return new Y.Doc();
  }, [docId]);

  // Stable Awareness per ydoc
  const awareness = useMemo(() => {
    if (!ydoc) return null;
    return new Awareness(ydoc);
  }, [ydoc]);

  const [isLoading, setIsLoading] = useState(!!docId);
  const [isSynced, setIsSynced] = useState(false);
  const [activeUsers, setActiveUsers] = useState<CollabUser[]>([]);
  const [agentActive, setAgentActive] = useState(false);
  const [agentPresent, setAgentPresent] = useState(false);
  const agentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollVersionRef = useRef(0);

  // Set local awareness state (user info for cursor labels)
  useEffect(() => {
    if (!awareness || !user) return;
    awareness.setLocalStateField("user", {
      name: user.name,
      email: user.email,
      color: user.color,
    });
  }, [awareness, user?.name, user?.email, user?.color]);

  // Track active users from awareness changes
  useEffect(() => {
    if (!awareness) return;

    const updateUsers = () => {
      const users: CollabUser[] = [];
      let hasAgent = false;
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === ydoc?.clientID) return; // Skip self
        if (state.user) {
          users.push(state.user as CollabUser);
          if ((state.user as CollabUser).email === "agent@system") {
            hasAgent = true;
          }
        }
      });
      setActiveUsers(users);
      setAgentPresent(hasAgent);
    };

    awareness.on("change", updateUsers);
    return () => {
      awareness.off("change", updateUsers);
    };
  }, [awareness, ydoc]);

  // Clean up on unmount or docId change
  useEffect(() => {
    return () => {
      awareness?.destroy();
      ydoc?.destroy();
    };
  }, [ydoc, awareness]);

  // Fetch server state and apply to existing doc
  useEffect(() => {
    if (!ydoc || !docId) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setIsSynced(false);

    fetch(`${baseUrl}/${docId}/state`)
      .then((res) => res.json())
      .then((data: { state: string }) => {
        if (cancelled) return;
        if (data.state) {
          const binary = base64ToUint8Array(data.state);
          if (binary.length > 4) {
            Y.applyUpdate(ydoc, binary);
          }
        }
        setIsLoading(false);
        setIsSynced(true);
      })
      .catch(() => {
        if (cancelled) return;
        setIsLoading(false);
        setIsSynced(true);
      });

    return () => {
      cancelled = true;
    };
  }, [ydoc, docId, baseUrl]);

  // Send local updates to server
  useEffect(() => {
    if (!ydoc || !docId) return;

    const handler = (update: Uint8Array, origin: unknown) => {
      if (origin === "remote") return;

      fetch(`${baseUrl}/${docId}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          update: uint8ArrayToBase64(update),
          requestSource,
        }),
      });
    };

    ydoc.on("update", handler);
    return () => {
      ydoc.off("update", handler);
    };
  }, [ydoc, docId, baseUrl, requestSource]);

  // Poll for remote doc updates + awareness sync
  useEffect(() => {
    if (!ydoc || !docId) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      if (stopped) return;
      try {
        // Poll for document updates
        const res = await fetch(
          `/_agent-native/poll?since=${pollVersionRef.current}`,
        );
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        const { version, events } = data as {
          version: number;
          events: Array<{
            source: string;
            docId?: string;
            update?: string;
            requestSource?: string;
          }>;
        };

        for (const evt of events) {
          if (evt.source === "collab" && evt.docId === docId && evt.update) {
            if (requestSource && evt.requestSource === requestSource) continue;
            Y.applyUpdate(ydoc, base64ToUint8Array(evt.update), "remote");

            // Show agent presence indicator briefly
            if (evt.requestSource === "agent") {
              setAgentActive(true);
              if (agentTimerRef.current) clearTimeout(agentTimerRef.current);
              agentTimerRef.current = setTimeout(
                () => setAgentActive(false),
                3000,
              );
            }
          }
        }

        pollVersionRef.current = version;

        // Sync awareness (cursor positions)
        if (awareness) {
          const localState = awareness.getLocalState();
          if (localState) {
            const awarenessRes = await fetch(`${baseUrl}/${docId}/awareness`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                clientId: ydoc.clientID,
                state: JSON.stringify(localState),
              }),
            });
            if (awarenessRes.ok) {
              const awarenessData = await awarenessRes.json();
              // Apply remote awareness states
              for (const remote of awarenessData.states || []) {
                try {
                  const remoteState = JSON.parse(remote.state);
                  awareness.setLocalStateField(
                    `remote_${remote.clientId}`,
                    null,
                  );
                  // Manually update the awareness state map for remote clients
                  const states = awareness.getStates();
                  states.set(remote.clientId, remoteState);
                  // Trigger awareness change event
                  awareness.emit("change", [
                    { added: [], updated: [remote.clientId], removed: [] },
                    "remote",
                  ]);
                } catch {
                  // Invalid state — skip
                }
              }
            }
          }
        }
      } catch {
        // Network error — retry next interval
      }
      if (!stopped) {
        timer = setTimeout(poll, pollInterval);
      }
    }

    poll();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [ydoc, awareness, docId, pollInterval, requestSource, baseUrl]);

  return {
    ydoc,
    awareness,
    isLoading,
    isSynced,
    activeUsers,
    agentActive,
    agentPresent,
  };
}
