/**
 * Client-side hook for collaborative document editing via Yjs.
 *
 * Creates a STABLE Y.Doc per docId that never changes identity. This allows
 * TipTap's Collaboration extension to bind once without editor recreation.
 * Server state is applied to the existing doc when it arrives.
 *
 * Also manages Yjs Awareness for cursor positions and user presence,
 * synced via polling to the server's awareness endpoint.
 *
 * Transport improvements (vs previous version):
 * - Local update POSTs are debounced and coalesced with Y.mergeUpdates (~80ms)
 *   to avoid per-keystroke requests. The batch is flushed immediately on
 *   visibilitychange/pagehide and before each poll/awareness cycle.
 * - GET state?stateVector= is NOT fetched on every poll cycle. It is fetched:
 *   (a) on (re)connect / initial load, (b) when a poll response indicates a
 *   gap (version jump > ring-buffer size), (c) after applying an update fails,
 *   and (d) as a low-frequency safety net every STATE_VECTOR_FETCH_INTERVAL
 *   poll cycles (~15×).
 * - Network errors use exponential backoff with jitter (cap ~15s), reset on
 *   success.
 * - SSE fast-path: collab events are received push-style from
 *   /_agent-native/events (the framework SSE stream). While SSE is
 *   healthy the poll loop relaxes to a slow cadence (10–15s). If SSE is
 *   unavailable the 2s poll resumes automatically.
 */

import { useEffect, useRef, useState, useMemo } from "react";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { agentNativePath } from "../client/api-path.js";
import { subscribeSyncEvents, type SyncEvent } from "../client/use-db-sync.js";
import { AGENT_CLIENT_ID } from "./agent-identity.js";

export interface CollabUser {
  name: string;
  email: string;
  color: string;
  /** Profile image shown in presence avatars, cursor flags, and edit tags. */
  avatarUrl?: string;
}

export interface UseCollaborativeDocOptions {
  /** Document ID to collaborate on. Pass null to disable. */
  docId: string | null;
  /** Poll interval in ms when SSE is unavailable. Default: 2000 */
  pollInterval?: number;
  /** Poll interval in ms while SSE is healthy. Default: 12000 */
  pollIntervalWithSse?: number;
  /** Pause remote update/presence polling while the tab is hidden. Default: true */
  pauseWhenHidden?: boolean;
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
  "#14b8a6",
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

function normalizeCollabEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isDocumentHidden(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

export function dedupeCollabUsersByEmail(users: CollabUser[]): CollabUser[] {
  const byEmail = new Map<string, CollabUser>();
  for (const user of users) {
    const email = normalizeCollabEmail(user.email);
    if (!email || byEmail.has(email)) continue;
    byEmail.set(email, {
      name: user.name || emailToName(email),
      email,
      color: user.color || emailToColor(email),
    });
  }
  return Array.from(byEmail.values());
}

/**
 * Leader election for applying authoritative external snapshots into a shared
 * collaborative document.
 *
 * When the agent (or a Notion pull, or any full-document rewrite) writes new
 * content to SQL, the open editor reconciles it into the live Y.Doc with
 * `setContent`. If EVERY connected client did that independently, each would
 * diff the same snapshot into the CRDT and the changed region would be inserted
 * N times (concurrent inserts at the same position → duplicated text). So only
 * ONE client — the "lead" — applies the snapshot; every other client receives
 * the result through normal Yjs sync.
 *
 * The lead is the present client with the lowest Yjs `clientID`. The agent's
 * awareness entry uses `AGENT_CLIENT_ID` (max int) so it can never be the lead,
 * and a client editing alone is always the lead. This is deterministic across
 * clients with no coordination round-trip.
 */
export function isReconcileLeadClient(
  awareness: Awareness | null | undefined,
  localClientId: number | null | undefined,
): boolean {
  if (localClientId == null) return false;
  if (!awareness) return true; // standalone / tests — act alone

  let hasPeer = false;
  let minVisible = localClientId;
  awareness.getStates().forEach((state, clientId) => {
    if (clientId === AGENT_CLIENT_ID) return; // agent never leads
    if (clientId === localClientId) return;
    const s = state as { user?: unknown; visible?: boolean };
    if (!s || !s.user) return; // skip empty/stale entries
    hasPeer = true;
    // Only VISIBLE peers can act; a peer published `visible: false` (backgrounded)
    // is skipped. A peer that hasn't published the field is treated as visible.
    if (s.visible !== false && clientId < minVisible) minVisible = clientId;
  });

  // Sole client: always the applier — no other client can duplicate the edit,
  // so single-user agent edits apply even if this tab reports hidden.
  if (!hasPeer) return true;

  // With peers present, exactly one VISIBLE client applies (the lowest clientId
  // among visible ones). A backgrounded tab pauses its poll and can't reliably
  // act, so it yields — otherwise an agent edit would never reach the tab the
  // user is actually looking at. The caller re-elects on visibility change.
  const localHidden =
    typeof document !== "undefined" && document.visibilityState === "hidden";
  if (localHidden) return false;
  return localClientId <= minVisible;
}

export interface RemoteAwarenessSnapshot {
  clientId: number;
  state: unknown;
}

export function reconcileRemoteAwarenessStates(
  states: Map<number, unknown>,
  localClientId: number,
  remoteStates: RemoteAwarenessSnapshot[],
): { added: number[]; updated: number[]; removed: number[] } {
  const incoming = new Set<number>();
  const added: number[] = [];
  const updated: number[] = [];
  const removed: number[] = [];

  for (const remote of remoteStates) {
    if (
      !Number.isFinite(remote.clientId) ||
      remote.clientId === localClientId
    ) {
      continue;
    }
    incoming.add(remote.clientId);
    const hadState = states.has(remote.clientId);
    states.set(remote.clientId, remote.state);
    (hadState ? updated : added).push(remote.clientId);
  }

  for (const clientId of Array.from(states.keys())) {
    if (clientId === localClientId) continue;
    if (incoming.has(clientId)) continue;
    states.delete(clientId);
    removed.push(clientId);
  }

  return { added, updated, removed };
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

/** Debounce delay for coalescing local Yjs update POSTs (ms). */
const UPDATE_DEBOUNCE_MS = 80;

/** Fetch state-vector every N poll cycles as a low-frequency safety net. */
const STATE_VECTOR_FETCH_INTERVAL = 15;

/** Poll ring-buffer size on the server (MAX_BUFFER in poll.ts). */
const POLL_RING_BUFFER_SIZE = 200;

/** Exponential backoff: base delay (ms), multiplier, cap (ms). */
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 15_000;

function calcBackoff(consecutiveErrors: number): number {
  const exp = Math.min(consecutiveErrors, 10);
  const delay = BACKOFF_BASE_MS * Math.pow(2, exp);
  // Add jitter: ±25%
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.min(delay + jitter, BACKOFF_MAX_MS);
}

// ---------------------------------------------------------------------------
// Fast awareness helper — throttled per (docId, ydocId) pair so multiple
// setLocalStateField calls within a 150ms window are coalesced into one POST.
// ---------------------------------------------------------------------------

const _awarenessThrottleTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();

function scheduleAwarenessPush(
  baseUrl: string,
  docId: string,
  clientId: number,
  getState: () => Record<string, unknown> | null,
): void {
  if (typeof window === "undefined") return;
  const key = `${docId}::${clientId}`;
  if (_awarenessThrottleTimers.has(key)) return; // already scheduled

  const timer = setTimeout(() => {
    _awarenessThrottleTimers.delete(key);
    const state = getState();
    fetch(`${baseUrl}/${docId}/awareness`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        state: state ? JSON.stringify(state) : null,
      }),
    }).catch(() => {}); // best-effort; poll cycle is the baseline fallback
  }, 150);

  _awarenessThrottleTimers.set(key, timer);
}

export function useCollaborativeDoc(
  options: UseCollaborativeDocOptions,
): UseCollaborativeDocResult {
  const {
    docId,
    pollInterval = 2000,
    pollIntervalWithSse = 12000,
    pauseWhenHidden = true,
    baseUrl = agentNativePath("/_agent-native/collab"),
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
  // Set when the initial state fetch returns 404/403 — stops the awareness
  // poll so we don't spam the console with errors against a doc that doesn't
  // exist or isn't accessible.
  const [docMissing, setDocMissing] = useState(false);
  const agentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollVersionRef = useRef(0);

  // Set local awareness state (user info for cursor labels). Also publish this
  // tab's visibility so peers can elect a VISIBLE client to apply external
  // snapshots (see isReconcileLeadClient) — a backgrounded tab pauses its poll
  // and must not hold that role.
  useEffect(() => {
    if (!awareness || !user) return;
    awareness.setLocalStateField("user", {
      name: user.name,
      email: user.email,
      color: user.color,
    });
    awareness.setLocalStateField("visible", !isDocumentHidden());
  }, [awareness, user?.name, user?.email, user?.color]);

  // Fast awareness push: whenever local state changes (e.g. cursor moves,
  // setPresence() calls), schedule a throttled POST so peers receive updates
  // at ~150ms instead of waiting for the next 2s poll cycle. The poll cycle
  // remains the authoritative baseline (cursors degrade gracefully without SSE).
  useEffect(() => {
    if (!awareness || !ydoc || !docId || !user) return;
    const clientId = ydoc.clientID;

    const onLocalStateChange = () => {
      scheduleAwarenessPush(
        baseUrl,
        docId,
        clientId,
        () => awareness.getLocalState() as Record<string, unknown> | null,
      );
    };

    // awareness emits "change" for local state changes too (when origin is "local").
    awareness.on("change", onLocalStateChange);
    return () => {
      awareness.off("change", onLocalStateChange);
    };
  }, [awareness, ydoc, docId, baseUrl, user]);

  // Track active users from awareness changes
  useEffect(() => {
    if (!awareness) return;

    let cancelled = false;
    let updateTimer: ReturnType<typeof setTimeout> | null = null;

    const applyUsers = () => {
      updateTimer = null;
      if (cancelled) return;
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
      setActiveUsers(dedupeCollabUsersByEmail(users));
      setAgentPresent(hasAgent);
    };
    const updateUsers = () => {
      if (updateTimer) clearTimeout(updateTimer);
      updateTimer = setTimeout(applyUsers, 0);
    };

    awareness.on("change", updateUsers);
    return () => {
      cancelled = true;
      if (updateTimer) clearTimeout(updateTimer);
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
    setDocMissing(false);

    fetch(`${baseUrl}/${docId}/state`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404 || res.status === 403) {
          setDocMissing(true);
          setIsLoading(false);
          setIsSynced(true);
          return;
        }
        const data = (await res.json().catch(() => null)) as {
          state?: string;
        } | null;
        if (data?.state) {
          const binary = base64ToUint8Array(data.state);
          if (binary.length > 4) {
            Y.applyUpdate(ydoc, binary, "remote");
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

  // Send local updates to server — debounced and coalesced with Y.mergeUpdates.
  //
  // Instead of firing one POST per Yjs update (one per keystroke), we accumulate
  // updates in a buffer for UPDATE_DEBOUNCE_MS then merge them into a single
  // request. The buffer is also flushed immediately on visibilitychange/pagehide
  // and before each poll/awareness cycle so we don't hold stale local state.
  useEffect(() => {
    if (!ydoc || !docId || docMissing) return;

    let pendingUpdates: Uint8Array[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flushPendingUpdates = (keepalive = false) => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (pendingUpdates.length === 0) return;
      const toSend = pendingUpdates;
      pendingUpdates = [];

      const merged = toSend.length === 1 ? toSend[0] : Y.mergeUpdates(toSend);
      fetch(`${baseUrl}/${docId}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          update: uint8ArrayToBase64(merged),
          requestSource,
        }),
        ...(keepalive ? { keepalive: true } : {}),
      }).catch(() => {});
    };

    // Expose flush to the poll loop via a ref so it can flush before each cycle.
    // We store the flusher in a closure-captured variable; the poll effect
    // below reads it through the shared `pendingFlushRef`.
    (ydoc as any).__collabFlush = flushPendingUpdates;

    const handler = (update: Uint8Array, origin: unknown) => {
      if (origin === "remote") return;
      pendingUpdates.push(update);
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(flushPendingUpdates, UPDATE_DEBOUNCE_MS);
    };

    const handlePageHide = () => {
      flushPendingUpdates(true /* keepalive */);
    };

    ydoc.on("update", handler);
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", handlePageHide);
    }

    return () => {
      ydoc.off("update", handler);
      delete (ydoc as any).__collabFlush;
      if (typeof window !== "undefined") {
        window.removeEventListener("pagehide", handlePageHide);
      }
      // Flush any remaining updates on teardown
      flushPendingUpdates(true);
    };
  }, [ydoc, docId, baseUrl, requestSource, docMissing]);

  // Poll for remote doc updates + awareness sync, with SSE fast-path.
  useEffect(() => {
    if (!ydoc || !docId || docMissing) return;
    // Non-null capture: null branch returned early above; async closures lose
    // the narrowing on the outer ydoc variable.
    const doc: Y.Doc = ydoc;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveErrors = 0;
    let pollCycleCount = 0;
    // Track the last version we successfully polled. Used to detect ring-buffer
    // overflow (version gap larger than the ring buffer).
    let lastPolledVersion = pollVersionRef.current;

    // SSE connection state. When SSE is healthy, poll interval is relaxed.
    let sseActive = false;

    // ── SSE fast-path ────────────────────────────────────────────────
    // Subscribe to the SHARED framework transport for /_agent-native/events
    // instead of opening a dedicated EventSource per collab doc. A tab holds
    // exactly one SSE connection regardless of how many docs are mounted —
    // extra streams eat the browser's per-origin connection budget and can
    // starve regular data fetches (worst on HTTP/1.1 dev servers).
    // Collab update events arrive push-style; we apply them immediately,
    // avoiding ~2s polling latency for peer edits.
    //
    // NOTE: SSE events are subject to the same server-side access scoping as
    // polling — the server only pushes events that canSeeChangeForUser allows.
    // The server tags collab events with owner/orgId (security commit).
    const handleSharedEvent = (change: SyncEvent) => {
      if (
        change.source === "collab" &&
        change.docId === docId &&
        typeof change.update === "string"
      ) {
        if (requestSource && change.requestSource === requestSource) return;
        try {
          Y.applyUpdate(doc, base64ToUint8Array(change.update), "remote");
        } catch {
          // Malformed update — trigger state-vector fetch on next poll
        }

        if (change.requestSource === "agent") {
          setAgentActive(true);
          if (agentTimerRef.current) clearTimeout(agentTimerRef.current);
          agentTimerRef.current = setTimeout(() => setAgentActive(false), 3000);
        }
      }

      // Keep pollVersionRef updated from shared-transport events so the poll
      // loop starts from the right version when SSE drops.
      if (typeof change.version === "number") {
        pollVersionRef.current = Math.max(
          pollVersionRef.current,
          change.version,
        );
      }
    };

    const unsubscribeSharedEvents = subscribeSyncEvents({
      onEvents: (events) => {
        if (stopped) return;
        for (const change of events) handleSharedEvent(change);
      },
      onSseStateChange: (connected) => {
        sseActive = connected;
        if (connected) consecutiveErrors = 0;
      },
      pauseWhenHidden,
    });

    // ── Poll loop ───────────────────────────────────────────────────
    function getActivePollInterval(): number {
      return sseActive ? pollIntervalWithSse : pollInterval;
    }

    function schedulePoll() {
      if (stopped) return;
      if (pauseWhenHidden && isDocumentHidden()) return;
      timer = setTimeout(poll, getActivePollInterval());
    }

    async function fetchStateVector(): Promise<void> {
      try {
        const stateVector = uint8ArrayToBase64(Y.encodeStateVector(doc));
        const stateRes = await fetch(
          `${baseUrl}/${docId}/state?stateVector=${encodeURIComponent(stateVector)}`,
        );
        if (stateRes.ok) {
          const stateData = (await stateRes.json().catch(() => null)) as {
            state?: string;
          } | null;
          if (stateData?.state) {
            const binary = base64ToUint8Array(stateData.state);
            if (binary.length > 2) {
              Y.applyUpdate(doc, binary, "remote");
            }
          }
        }
      } catch {
        // Non-fatal; the next poll cycle will retry
      }
    }

    async function poll() {
      if (stopped) return;

      // Flush any pending local updates before polling so the server has the
      // latest state before we read remote changes.
      const flush = (ydoc as any).__collabFlush as
        | ((keepalive?: boolean) => void)
        | undefined;
      flush?.();

      try {
        const res = await fetch(
          agentNativePath(
            `/_agent-native/poll?since=${pollVersionRef.current}`,
          ),
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

        // Detect ring-buffer overflow: if the version jumped by more than the
        // ring buffer size, some events were evicted and we need a state-vector
        // fetch to reconcile the gap.
        const versionGap = version - lastPolledVersion;
        const hadGap = versionGap > POLL_RING_BUFFER_SIZE;

        for (const evt of events) {
          if (evt.source === "collab" && evt.docId === docId && evt.update) {
            if (requestSource && evt.requestSource === requestSource) continue;
            try {
              Y.applyUpdate(doc, base64ToUint8Array(evt.update), "remote");
            } catch {
              // Failed to apply — fetch full state-vector below
              await fetchStateVector();
            }

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
        lastPolledVersion = version;
        pollCycleCount++;
        consecutiveErrors = 0;

        // Fetch state-vector only when needed:
        //   1. Ring-buffer overflow detected (missed events).
        //   2. Low-frequency safety net every STATE_VECTOR_FETCH_INTERVAL cycles.
        //   3. NOT on every cycle (the previous behavior causing 3 requests/cycle).
        const shouldFetchStateVector =
          hadGap || pollCycleCount % STATE_VECTOR_FETCH_INTERVAL === 0;

        if (shouldFetchStateVector) {
          await fetchStateVector();
        }

        // Sync awareness (cursor positions)
        if (awareness) {
          const localState = awareness.getLocalState();
          if (localState) {
            try {
              const awarenessRes = await fetch(
                `${baseUrl}/${docId}/awareness`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    clientId: doc.clientID,
                    state: JSON.stringify(localState),
                  }),
                },
              );
              if (awarenessRes.ok) {
                const awarenessData = await awarenessRes.json();
                const remoteStates: RemoteAwarenessSnapshot[] = [];
                for (const remote of awarenessData.states || []) {
                  try {
                    const remoteState = JSON.parse(remote.state);
                    remoteStates.push({
                      clientId: Number(remote.clientId),
                      state: remoteState,
                    });
                  } catch {
                    // Invalid state — skip
                  }
                }
                const changes = reconcileRemoteAwarenessStates(
                  awareness.getStates() as Map<number, unknown>,
                  doc.clientID,
                  remoteStates,
                );
                if (
                  changes.added.length ||
                  changes.updated.length ||
                  changes.removed.length
                ) {
                  awareness.emit("change", [changes, "remote"]);
                }
              }
            } catch {
              // Awareness sync failure is non-fatal
            }
          }
        }
      } catch {
        // Network error — exponential backoff
        consecutiveErrors++;
        const backoff = calcBackoff(consecutiveErrors);
        if (!stopped) {
          timer = setTimeout(poll, backoff);
          return;
        }
      }

      schedulePoll();
    }

    function pollNow() {
      if (pauseWhenHidden && isDocumentHidden()) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      void poll();
    }

    // Publish this tab's visibility to peers. A hidden tab pauses its poll, so
    // we push the state immediately (keepalive) instead of waiting for the next
    // cycle — otherwise peers keep treating a backgrounded tab as the visible
    // lead and an agent edit never lands on the tab the user is actually viewing.
    function publishVisibility(visible: boolean) {
      if (!awareness) return;
      awareness.setLocalStateField("visible", visible);
      const localState = awareness.getLocalState();
      if (!localState) return;
      fetch(`${baseUrl}/${docId}/awareness`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: doc.clientID,
          state: JSON.stringify(localState),
        }),
        keepalive: true,
      }).catch(() => {});
    }

    function handleVisibilityChange() {
      const visible = document.visibilityState === "visible";
      publishVisibility(visible);
      if (visible) {
        // Also flush any pending updates when coming back into view
        const flush = (ydoc as any).__collabFlush as
          | ((keepalive?: boolean) => void)
          | undefined;
        flush?.();
        pollNow();
      } else if (pauseWhenHidden && timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    if (!pauseWhenHidden || !isDocumentHidden()) {
      void poll();
    }
    window.addEventListener("focus", pollNow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      unsubscribeSharedEvents();
      window.removeEventListener("focus", pollNow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    ydoc,
    awareness,
    docId,
    pollInterval,
    pollIntervalWithSse,
    pauseWhenHidden,
    requestSource,
    baseUrl,
    docMissing,
  ]);

  // SSE fast-path for awareness: listen on the SHARED framework transport and
  // apply any awareness-change events immediately so peers receive cursor
  // moves push-style without waiting for the next poll cycle.
  // Polling fallback keeps working when SSE is unavailable. Reconnection and
  // focus/visibility handling live inside the shared transport.
  useEffect(() => {
    if (!ydoc || !docId || !awareness) {
      return;
    }
    // Non-null captures for closures: null branches returned early above.
    const capturedYdoc = ydoc;
    const capturedAwareness = awareness;
    let stopped = false;

    const applyAwarenessEvent = (data: SyncEvent) => {
      if (
        data.source !== "awareness" ||
        data.type !== "awareness-change" ||
        data.docId !== docId
      ) {
        return;
      }
      const states = Array.isArray(data.states)
        ? (data.states as Array<{ clientId: number; state: string }>)
        : [];
      const remoteStates: RemoteAwarenessSnapshot[] = [];
      for (const remote of states) {
        try {
          remoteStates.push({
            clientId: Number(remote.clientId),
            state: JSON.parse(remote.state),
          });
        } catch {
          // Invalid state entry — skip
        }
      }
      const changes = reconcileRemoteAwarenessStates(
        capturedAwareness.getStates() as Map<number, unknown>,
        capturedYdoc.clientID,
        remoteStates,
      );
      if (
        changes.added.length ||
        changes.updated.length ||
        changes.removed.length
      ) {
        capturedAwareness.emit("change", [changes, "remote"]);
      }
    };

    const unsubscribe = subscribeSyncEvents({
      onEvents: (events) => {
        if (stopped) return;
        for (const data of events) applyAwarenessEvent(data);
      },
    });

    return () => {
      stopped = true;
      unsubscribe();
    };
  }, [ydoc, docId, awareness]);

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
