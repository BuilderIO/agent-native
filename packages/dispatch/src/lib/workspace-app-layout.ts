import {
  orderChatFirstAppIds,
  readChatFirstAppLayout,
  writeChatFirstAppLayout,
  type ChatFirstAppLayoutPreference,
} from "@agent-native/core/client/agent-chat";
import {
  readClientAppState,
  writeClientAppState,
} from "@agent-native/core/client/application-state";
import { useEffect, useSyncExternalStore } from "react";

export const WORKSPACE_APP_LAYOUT_STATE_KEY = "chat-first-app-layout";

export type WorkspaceAppLayoutPersistenceError =
  | "device"
  | "workspace"
  | "both";

export function normalizeWorkspaceAppLayout(
  value: unknown,
): ChatFirstAppLayoutPreference {
  if (!value || typeof value !== "object") {
    return { pinnedIds: [], orderedIds: [] };
  }

  const candidate = value as Partial<ChatFirstAppLayoutPreference>;
  const ids = (input: unknown): string[] =>
    Array.isArray(input)
      ? [
          ...new Set(
            input
              .filter(
                (id): id is string =>
                  typeof id === "string" && id.trim().length > 0,
              )
              .map((id) => id.trim().toLowerCase()),
          ),
        ]
      : [];

  return {
    pinnedIds: ids(candidate.pinnedIds),
    orderedIds: ids(candidate.orderedIds),
  };
}

export function orderWorkspaceApps<T extends { id: string }>(
  apps: readonly T[],
  layout: ChatFirstAppLayoutPreference,
): T[] {
  const appIds = apps.map((app) => app.id.trim().toLowerCase());
  const appsById = new Map(
    apps.map((app) => [app.id.trim().toLowerCase(), app]),
  );
  return orderChatFirstAppIds(appIds, normalizeWorkspaceAppLayout(layout))
    .map((id) => appsById.get(id))
    .filter((app): app is T => Boolean(app));
}

export function workspaceAppMatchesQuery(
  app: { name: string; description?: string | undefined },
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return `${app.name} ${app.description ?? ""}`
    .toLowerCase()
    .includes(normalizedQuery);
}

/** Pins (newest first) or unpins `appId`; a no-op when it already matches. */
export function setWorkspaceAppPinned(
  layout: ChatFirstAppLayoutPreference,
  appId: string,
  pinned: boolean,
): ChatFirstAppLayoutPreference {
  const normalizedLayout = normalizeWorkspaceAppLayout(layout);
  const normalizedAppId = appId.trim().toLowerCase();
  const isPinned = normalizedLayout.pinnedIds.includes(normalizedAppId);
  if (isPinned === pinned) return normalizedLayout;
  const pinnedIds = pinned
    ? [normalizedAppId, ...normalizedLayout.pinnedIds]
    : normalizedLayout.pinnedIds.filter((id) => id !== normalizedAppId);
  return { ...normalizedLayout, pinnedIds };
}

export type WorkspaceAppsStatus = "loading" | "error" | "ready";

/**
 * The workspace app list is known once it has arrived, and a failed refresh
 * keeps the last one. Until then nothing can be tiered: an empty list is not
 * "no apps", and a hosted app cannot be told from a mounted one.
 */
export function workspaceAppsStatus(query: {
  data: unknown;
  isError: boolean;
}): WorkspaceAppsStatus {
  if (query.data !== undefined) return "ready";
  return query.isError ? "error" : "loading";
}

/**
 * Both app lists: ready once workspace apps arrived and the hosted list has
 * settled (arrived or failed), so the tiers, and the header actions placed by
 * them, do not reshuffle when hosted apps land a moment later.
 */
export function appListsStatus(
  workspaceApps: { data: unknown; isError: boolean },
  connectedApps: { data: unknown; isError: boolean },
): WorkspaceAppsStatus {
  const status = workspaceAppsStatus(workspaceApps);
  if (status !== "ready") return status;
  return connectedApps.data === undefined && !connectedApps.isError
    ? "loading"
    : "ready";
}

/** Whether any of `apps` is pinned, before a search narrows the list. */
export function hasPinnedWorkspaceApp(
  apps: readonly { id: string }[],
  layout: ChatFirstAppLayoutPreference,
): boolean {
  const pinned = new Set(normalizeWorkspaceAppLayout(layout).pinnedIds);
  return apps.some((app) => pinned.has(app.id.trim().toLowerCase()));
}

export interface WorkspaceAppTiers<T> {
  pinned: T[];
  apps: T[];
  hosted: T[];
}

export function compareWorkspaceAppNames(
  a: { name: string },
  b: { name: string },
): number {
  return a.name.localeCompare(b.name);
}

/**
 * Pinned apps leave their home tier and keep pin order (newest first). The
 * Apps and Hosted apps (built-in catalog) tiers each sort A to Z.
 */
export function tierWorkspaceApps<
  T extends { id: string; name: string; source?: string | undefined },
>(
  apps: readonly T[],
  layout: ChatFirstAppLayoutPreference,
): WorkspaceAppTiers<T> {
  const appsById = new Map(
    apps.map((app) => [app.id.trim().toLowerCase(), app]),
  );
  const pinned = normalizeWorkspaceAppLayout(layout)
    .pinnedIds.map((id) => appsById.get(id))
    .filter((app): app is T => Boolean(app));
  const pinnedSet = new Set(pinned);
  const unpinned = apps.filter((app) => !pinnedSet.has(app));
  return {
    pinned,
    apps: unpinned
      .filter((app) => app.source !== "builtin")
      .sort(compareWorkspaceAppNames),
    hosted: unpinned
      .filter((app) => app.source === "builtin")
      .sort(compareWorkspaceAppNames),
  };
}

interface WorkspaceAppLayoutSnapshot {
  layout: ChatFirstAppLayoutPreference;
  /** `writeId` is new for each save, so a dismissed notice shows again. */
  persistenceError: {
    scope: WorkspaceAppLayoutPersistenceError;
    writeId: number;
  } | null;
}

type WorkspaceAppLayoutUpdate = (
  layout: ChatFirstAppLayoutPreference,
) => ChatFirstAppLayoutPreference;

const SERVER_SNAPSHOT: WorkspaceAppLayoutSnapshot = {
  layout: { pinnedIds: [], orderedIds: [] },
  persistenceError: null,
};

// One store per page: every surface reads and writes the same pins, so a
// write always starts from the latest layout instead of a surface's copy.
let snapshot: WorkspaceAppLayoutSnapshot | null = null;
// Workspace state is written only after it has been read: until then a write
// would replace saved pins this page never saw. "failed" retries the read.
let hydration: "idle" | "pending" | "failed" | "done" = "idle";
// Changes made before workspace state was read. They replay onto the read
// layout, then persist.
let pendingUpdates: WorkspaceAppLayoutUpdate[] = [];
let deviceSaved = true;
let writeSequence = 0;
const listeners = new Set<() => void>();

function currentSnapshot(): WorkspaceAppLayoutSnapshot {
  snapshot ??= {
    layout: normalizeWorkspaceAppLayout(readChatFirstAppLayout()),
    persistenceError: null,
  };
  return snapshot;
}

function setSnapshot(next: Partial<WorkspaceAppLayoutSnapshot>) {
  snapshot = { ...currentSnapshot(), ...next };
  for (const listener of listeners) listener();
}

function writeDeviceLayout(next: ChatFirstAppLayoutPreference) {
  deviceSaved = writeChatFirstAppLayout(next).ok;
}

function settlePersistence(writeId: number, workspaceSaved: boolean) {
  if (writeId !== writeSequence) return;
  const scope: WorkspaceAppLayoutPersistenceError | null = workspaceSaved
    ? deviceSaved
      ? null
      : "device"
    : deviceSaved
      ? "workspace"
      : "both";
  setSnapshot({ persistenceError: scope ? { scope, writeId } : null });
}

function persistWorkspaceAppLayout(next: ChatFirstAppLayoutPreference) {
  writeDeviceLayout(next);
  const writeId = ++writeSequence;
  void writeClientAppState(WORKSPACE_APP_LAYOUT_STATE_KEY, next).then(
    () => settlePersistence(writeId, true),
    () => settlePersistence(writeId, false),
  );
}

function finishHydration(saved: ChatFirstAppLayoutPreference | null) {
  hydration = "done";
  const updates = pendingUpdates;
  pendingUpdates = [];
  // Absent workspace state keeps the device layout, which already holds the
  // queued updates.
  const next = saved
    ? updates.reduce(
        (layout, update) => normalizeWorkspaceAppLayout(update(layout)),
        saved,
      )
    : currentSnapshot().layout;
  setSnapshot({ layout: next });
  if (updates.length > 0) {
    persistWorkspaceAppLayout(next);
    return;
  }
  if (saved) writeDeviceLayout(next);
  // Nothing was saved before this read, so the only error it can clear is
  // the earlier read failure.
  setSnapshot({ persistenceError: null });
}

function hydrateWorkspaceAppLayout() {
  if (hydration === "pending" || hydration === "done") return;
  hydration = "pending";
  void readClientAppState<unknown>(WORKSPACE_APP_LAYOUT_STATE_KEY).then(
    (value) =>
      finishHydration(
        value === null ? null : normalizeWorkspaceAppLayout(value),
      ),
    () => {
      hydration = "failed";
      // Only unsaved pins make a failed read worth reporting.
      if (pendingUpdates.length > 0) settlePersistence(++writeSequence, false);
    },
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function updateWorkspaceAppLayout(update: WorkspaceAppLayoutUpdate) {
  const next = normalizeWorkspaceAppLayout(update(currentSnapshot().layout));
  setSnapshot({ layout: next });
  if (hydration === "done") {
    persistWorkspaceAppLayout(next);
    return;
  }
  pendingUpdates.push(update);
  writeDeviceLayout(next);
  if (hydration === "failed") settlePersistence(++writeSequence, false);
  hydrateWorkspaceAppLayout();
}

// The click decides pin or unpin from what is on screen, so a change replayed
// onto workspace pins read later keeps that intent.
function togglePinned(appId: string) {
  const pinned = !currentSnapshot().layout.pinnedIds.includes(
    appId.trim().toLowerCase(),
  );
  updateWorkspaceAppLayout((layout) =>
    setWorkspaceAppPinned(layout, appId, pinned),
  );
}

/** Test-only: forget the page's layout so the next read starts from storage. */
export function resetWorkspaceAppLayoutStoreForTests() {
  snapshot = null;
  hydration = "idle";
  pendingUpdates = [];
  deviceSaved = true;
  writeSequence = 0;
  listeners.clear();
}

export function useWorkspaceAppLayout({
  hydrate = true,
}: { hydrate?: boolean } = {}) {
  const { layout, persistenceError } = useSyncExternalStore(
    subscribe,
    currentSnapshot,
    () => SERVER_SNAPSHOT,
  );
  useEffect(() => {
    if (hydrate) hydrateWorkspaceAppLayout();
  }, [hydrate]);
  return { layout, persistenceError, togglePinned };
}
