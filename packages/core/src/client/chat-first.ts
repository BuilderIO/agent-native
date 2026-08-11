import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

export const CHAT_FIRST_MODE_STORAGE_KEY = "agent-native:chat-first-mode:v1";
export const CHAT_FIRST_APP_LAYOUT_STORAGE_KEY =
  "agent-native:chat-first-app-layout:v1";
export const CHAT_FIRST_SURFACE_TABS_STORAGE_KEY =
  "agent-native:chat-first-surface-tabs:v1";
export const CHAT_FIRST_SURFACE_WIDTH_STORAGE_KEY =
  "agent-native:chat-first-surface-width:v2";
export const CHAT_FIRST_SURFACE_PANEL_STORAGE_KEY =
  "agent-native:chat-first-surface-panel:v1";
export const CHAT_FIRST_MODE_CHANGED_EVENT = "agentNative:chatFirstModeChanged";
export const CHAT_FIRST_OPEN_APP_EVENT = "agentNative:openApp";
export const CHAT_FIRST_OPEN_BROWSER_EVENT = "agentNative:openBrowser";
export const CHAT_FIRST_WATCH_SESSION_EVENT = "agentNative:watchSession";

export type ChatFirstOpenAppDetail = {
  app?: string;
  path?: string;
  url?: string;
  view?: string;
};

export type ChatFirstOpenBrowserDetail = {
  url?: string;
  title?: string;
};

export type ChatFirstSessionKind = "code-agent" | "agent-chat" | "external";

export interface ChatFirstSessionReference {
  sessionId: string;
  title?: string;
  kind?: ChatFirstSessionKind;
  goalId?: string;
  sourceSessionId?: string;
}

export type ChatFirstSessionWatchState = {
  target: ChatFirstSessionReference | null;
};

export interface ChatFirstSessionWatchStore {
  getSnapshot: () => ChatFirstSessionWatchState;
  subscribe: (listener: () => void) => () => void;
  hasSubscribers: () => boolean;
  open: (target: ChatFirstSessionReference) => void;
  close: () => void;
}

export type ChatFirstSurfaceKind =
  | "app"
  | "browser"
  | "terminal"
  | "diff"
  | "files"
  | "side-chat"
  | "agents";

export type ChatFirstAppSurfacePlacement = "main" | "side";

export interface ChatFirstSurfaceTab {
  id: string;
  kind: ChatFirstSurfaceKind;
  title: string;
  appId?: string;
  /** App tabs can either replace the main chat or sit beside it. */
  placement?: ChatFirstAppSurfacePlacement;
  path?: string;
  view?: string;
  url?: string;
  session?: ChatFirstSessionReference;
  disabledReason?: string;
}

export type ChatFirstAgentActivityStatus =
  | "queued"
  | "running"
  | "paused"
  | "needs-approval"
  | "completed"
  | "errored"
  | "recent"
  | "unknown";

/** The renderer-neutral subset used by the shared agent activity surface. */
export interface ChatFirstAgentActivity {
  sessionId: string;
  title: string;
  subtitle?: string;
  status: ChatFirstAgentActivityStatus;
  updatedAt?: string | number;
  progressPercent?: number;
  goalId?: string;
}

export interface ChatFirstSurfaceTabsState {
  tabs: ChatFirstSurfaceTab[];
  activeTabId: string | null;
}

export interface ChatFirstSurfaceTabsStore {
  getSnapshot: () => ChatFirstSurfaceTabsState;
  subscribe: (listener: () => void) => () => void;
  open: (tab: ChatFirstSurfaceTab) => void;
  activate: (tabId: string) => void;
  close: (tabId: string) => void;
  closeOthers: (tabId: string) => void;
  closeToRight: (tabId: string) => void;
  closeAll: () => void;
}

export interface ChatFirstSurfacePanelState {
  open: boolean;
}

export interface ChatFirstSurfacePanelStore {
  getSnapshot: () => ChatFirstSurfacePanelState;
  subscribe: (listener: () => void) => () => void;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const CHAT_FIRST_SURFACE_CATALOG: readonly {
  kind: ChatFirstSurfaceKind;
  label: string;
  description: string;
  availability: "both" | "desktop" | "deferred";
  disabledReason?: string;
}[] = [
  {
    kind: "browser",
    label: "Browser",
    description: "Open a regular web page with address-bar controls.",
    availability: "both",
  },
  {
    kind: "terminal",
    label: "Terminal",
    description: "Run commands beside the conversation.",
    availability: "deferred",
    disabledReason:
      "Deferred in this release: the existing terminal is a standalone host surface; a shared PTY lifecycle is needed for an embedded pane.",
  },
  {
    kind: "files",
    label: "Files",
    description: "Browse the active workspace tree.",
    availability: "deferred",
    disabledReason:
      "Deferred in this release: neither client exposes a bounded workspace tree to this shared pane contract yet.",
  },
  {
    kind: "diff",
    label: "Diff",
    description: "Review the current changeset.",
    availability: "deferred",
    disabledReason:
      "Deferred in this release: diff blocks remain available in chat while a shared changed-file source is defined.",
  },
  {
    kind: "side-chat",
    label: "Side chat",
    description: "Watch and message another session beside the main chat.",
    availability: "both",
    disabledReason: "Choose Watch and message from any chat row.",
  },
  {
    kind: "agents",
    label: "Agents",
    description: "Review agent sessions and watch one beside the conversation.",
    availability: "both",
    disabledReason: "Review recent runs or watch one beside this conversation.",
  },
];

const CHAT_FIRST_SURFACE_KINDS: readonly ChatFirstSurfaceKind[] = [
  "app",
  "browser",
  "terminal",
  "diff",
  "files",
  "side-chat",
  "agents",
];

export function chatFirstSurfaceTabId(
  kind: ChatFirstSurfaceKind,
  value: string,
): string {
  return `${kind}:${value}`;
}

export const CHAT_FIRST_SURFACE_WIDTH_DEFAULT = 380;
export const CHAT_FIRST_SURFACE_WIDTH_MIN = 320;

/**
 * The first-run rail is intentionally opinionated. These are the five
 * everyday workspace apps shown before the user expands the rest of the
 * catalog; an explicit ordered layout still wins after the first change.
 */
export const CHAT_FIRST_DEFAULT_APP_IDS = [
  "content",
  "design",
  "mail",
  "calendar",
  "clips",
] as const;

export function clampChatFirstSurfaceWidth(
  value: number,
  viewportWidth = typeof window === "undefined"
    ? Number.POSITIVE_INFINITY
    : window.innerWidth,
): number {
  const max = Math.max(
    CHAT_FIRST_SURFACE_WIDTH_MIN,
    Math.floor(viewportWidth * 0.7),
  );
  return Math.min(
    max,
    Math.max(CHAT_FIRST_SURFACE_WIDTH_MIN, Math.round(value)),
  );
}

function surfaceWidthStorageKey(scope: string): string {
  return `${CHAT_FIRST_SURFACE_WIDTH_STORAGE_KEY}:${normalizedSurfaceScope(scope)}`;
}

export function readChatFirstSurfaceWidth(
  scope = "default",
  storage: StringStorage | null = browserStorage(),
): number {
  if (!storage) return CHAT_FIRST_SURFACE_WIDTH_DEFAULT;
  try {
    const raw = storage.getItem(surfaceWidthStorageKey(scope));
    if (!raw) return CHAT_FIRST_SURFACE_WIDTH_DEFAULT;
    const value = Number(raw);
    return Number.isFinite(value)
      ? clampChatFirstSurfaceWidth(value)
      : CHAT_FIRST_SURFACE_WIDTH_DEFAULT;
  } catch {
    return CHAT_FIRST_SURFACE_WIDTH_DEFAULT;
  }
}

export function writeChatFirstSurfaceWidth(
  width: number,
  scope = "default",
  storage: StringStorage | null = browserStorage(),
): { ok: true } | { ok: false; reason: "unavailable" | "write-failed" } {
  if (!storage) return { ok: false, reason: "unavailable" };
  try {
    storage.setItem(
      surfaceWidthStorageKey(scope),
      String(clampChatFirstSurfaceWidth(width)),
    );
    return { ok: true };
  } catch {
    return { ok: false, reason: "write-failed" };
  }
}

export function useChatFirstSurfaceResize(scope = "default") {
  const [width, setWidth] = useState(() => readChatFirstSurfaceWidth(scope));
  const [isResizing, setIsResizing] = useState(false);
  const widthRef = useRef(width);
  const cleanupRef = useRef<(() => void) | null>(null);
  widthRef.current = width;

  useEffect(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    const next = readChatFirstSurfaceWidth(scope);
    widthRef.current = next;
    setWidth(next);
    setIsResizing(false);
    return () => cleanupRef.current?.();
  }, [scope]);

  const onPointerDown = useCallback(
    (event: { clientX: number; preventDefault: () => void }) => {
      if (typeof window === "undefined") return;
      event.preventDefault();
      cleanupRef.current?.();
      const startX = event.clientX;
      const startWidth = widthRef.current;
      setIsResizing(true);
      const handleMove = (moveEvent: PointerEvent) => {
        const next = clampChatFirstSurfaceWidth(
          startWidth - (moveEvent.clientX - startX),
        );
        widthRef.current = next;
        setWidth(next);
      };
      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        cleanupRef.current = null;
        setIsResizing(false);
        writeChatFirstSurfaceWidth(widthRef.current, scope);
      };
      cleanupRef.current = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp, { once: true });
    },
    [scope],
  );

  return { width, isResizing, onPointerDown };
}

function surfacePanelStorageKey(scope: string): string {
  return `${CHAT_FIRST_SURFACE_PANEL_STORAGE_KEY}:${normalizedSurfaceScope(scope)}`;
}

function createChatFirstSurfacePanelStore(
  scope: string,
): ChatFirstSurfacePanelStore {
  let state: ChatFirstSurfacePanelState = { open: false };
  const listeners = new Set<() => void>();
  try {
    state = {
      open: browserStorage()?.getItem(surfacePanelStorageKey(scope)) === "true",
    };
    // coercion-ok: device-local panel preference failure falls back to the closed in-memory state.
  } catch {
    // The panel is an optional device preference; the live default is closed.
  }
  const publish = (open: boolean) => {
    if (state.open === open) return;
    state = { open };
    try {
      browserStorage()?.setItem(surfacePanelStorageKey(scope), String(open));
      // coercion-ok: device-local persistence failure leaves the in-memory toggle usable.
    } catch {
      // Keep the in-memory toggle usable when device storage is unavailable.
    }
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setOpen: publish,
    toggle: () => publish(!state.open),
  };
}

const chatFirstSurfacePanelStores = new Map<
  string,
  ChatFirstSurfacePanelStore
>();

export function getChatFirstSurfacePanelStore(
  scope = "default",
): ChatFirstSurfacePanelStore {
  const key = normalizedSurfaceScope(scope);
  const existing = chatFirstSurfacePanelStores.get(key);
  if (existing) return existing;
  const store = createChatFirstSurfacePanelStore(key);
  chatFirstSurfacePanelStores.set(key, store);
  return store;
}

export function useChatFirstSurfacePanel(scope = "default") {
  const store = getChatFirstSurfacePanelStore(scope);
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.altKey &&
        event.key.toLowerCase() === "b"
      ) {
        event.preventDefault();
        store.toggle();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [store]);

  return { ...state, setOpen: store.setOpen, toggle: store.toggle };
}

export interface ChatFirstSessionWatchDelivery {
  delivered: boolean;
  reason?: "empty-detail" | "no-listener";
}

export type ChatFirstBrowserResolution =
  | {
      status: "ready";
      target: { url: string; title?: string; openExternally?: boolean };
    }
  | { status: "unresolved"; reason: "empty-detail" | "invalid-url" };

export interface ChatFirstAppRegistration {
  id: string;
  name?: string;
  enabled?: boolean;
  /** The app's current production or mounted URL. */
  url?: string | null;
  /** Optional local development URL used by the desktop shell. */
  devUrl?: string | null;
  /** Mounted path used when an app has no absolute URL. */
  path?: string | null;
}

export interface ChatFirstAppTarget {
  appId: string;
  path?: string;
  view?: string;
}

export type ChatFirstAppResolution =
  | { status: "ready"; target: ChatFirstAppTarget }
  | {
      status: "unresolved";
      reason: "empty-detail" | "unknown-app" | "invalid-url";
    };

export interface ChatFirstOpenAppDelivery {
  delivered: boolean;
  reason?: "empty-detail" | "no-listener";
}

export interface ChatFirstAppLayoutPreference {
  pinnedIds: string[];
  orderedIds: string[];
}

export interface ChatFirstModeReadResult {
  enabled: boolean;
  availability: "available" | "unavailable";
}

type StringStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): StringStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
    // coercion-ok: callers receive null and expose unavailable device storage explicitly.
  } catch {
    return null;
  }
}

export function readChatFirstModeState(
  storage: StringStorage | null = browserStorage(),
): ChatFirstModeReadResult {
  if (!storage) {
    return { enabled: true, availability: "unavailable" };
  }
  try {
    const stored = storage.getItem(CHAT_FIRST_MODE_STORAGE_KEY);
    return {
      enabled: stored == null ? true : stored === "true",
      availability: "available",
    };
  } catch {
    return { enabled: true, availability: "unavailable" };
  }
}

export function readChatFirstMode(
  storage: StringStorage | null = browserStorage(),
): boolean {
  return readChatFirstModeState(storage).enabled;
}

export function writeChatFirstMode(
  enabled: boolean,
  storage: StringStorage | null = browserStorage(),
): { ok: true } | { ok: false; reason: "unavailable" | "write-failed" } {
  if (!storage) return { ok: false, reason: "unavailable" };
  try {
    storage.setItem(CHAT_FIRST_MODE_STORAGE_KEY, String(enabled));
    return { ok: true };
  } catch {
    return { ok: false, reason: "write-failed" };
  }
}

const EMPTY_CHAT_FIRST_APP_LAYOUT: ChatFirstAppLayoutPreference = {
  pinnedIds: [],
  orderedIds: [],
};

export function readChatFirstAppLayout(
  storage: StringStorage | null = browserStorage(),
): ChatFirstAppLayoutPreference {
  if (!storage) return { ...EMPTY_CHAT_FIRST_APP_LAYOUT };
  try {
    const raw = storage.getItem(CHAT_FIRST_APP_LAYOUT_STORAGE_KEY);
    if (!raw) return { ...EMPTY_CHAT_FIRST_APP_LAYOUT };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { ...EMPTY_CHAT_FIRST_APP_LAYOUT };
    }
    const value = parsed as Record<string, unknown>;
    const ids = (candidate: unknown): string[] =>
      Array.isArray(candidate)
        ? candidate.filter(
            (item): item is string =>
              typeof item === "string" && item.trim().length > 0,
          )
        : [];
    return {
      pinnedIds: [...new Set(ids(value.pinnedIds))],
      orderedIds: [...new Set(ids(value.orderedIds))],
    };
  } catch {
    return { ...EMPTY_CHAT_FIRST_APP_LAYOUT };
  }
}

export function writeChatFirstAppLayout(
  layout: ChatFirstAppLayoutPreference,
  storage: StringStorage | null = browserStorage(),
): { ok: true } | { ok: false; reason: "unavailable" | "write-failed" } {
  if (!storage) return { ok: false, reason: "unavailable" };
  try {
    storage.setItem(
      CHAT_FIRST_APP_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        pinnedIds: [...new Set(layout.pinnedIds.filter(Boolean))],
        orderedIds: [...new Set(layout.orderedIds.filter(Boolean))],
      }),
    );
    return { ok: true };
  } catch {
    return { ok: false, reason: "write-failed" };
  }
}

export function orderChatFirstAppIds(
  appIds: readonly string[],
  layout: ChatFirstAppLayoutPreference,
): string[] {
  const available = new Set(appIds);
  const preferredDefaults = CHAT_FIRST_DEFAULT_APP_IDS.filter((id) =>
    available.has(id),
  );
  const preferredDefaultSet = new Set<string>(preferredDefaults);
  const fallbackOrder = [
    ...preferredDefaults,
    ...appIds.filter((id) => !preferredDefaultSet.has(id)),
  ];
  const manualOrderedIds = layout.orderedIds.filter((id) => available.has(id));
  const hasManualOrder = manualOrderedIds.length > 0;
  const ordered = [
    ...manualOrderedIds,
    ...fallbackOrder.filter((id) => !layout.orderedIds.includes(id)),
  ];
  const pinnedIds = layout.pinnedIds.filter((id) => available.has(id));
  const pinned = new Set(pinnedIds);
  // A live `orderedIds` value is the single source of positional truth. Pinning
  // changes presentation only; it must not rewrite the user's drag order or
  // make an unpinned app jump to the fallback order.
  if (!hasManualOrder) {
    return [...pinnedIds, ...fallbackOrder.filter((id) => !pinned.has(id))];
  }
  return [
    ...ordered.filter((id) => pinned.has(id)),
    ...ordered.filter((id) => !pinned.has(id)),
  ];
}

export function resolveChatFirstBrowserTarget(
  detail: ChatFirstOpenBrowserDetail,
): ChatFirstBrowserResolution {
  const rawUrl = detail.url?.trim();
  if (!rawUrl) return { status: "unresolved", reason: "empty-detail" };
  const url = parseAbsoluteHttpUrl(rawUrl);
  if (!url || url.username || url.password) {
    return { status: "unresolved", reason: "invalid-url" };
  }
  return {
    status: "ready",
    target: {
      url: url.href,
      ...(detail.title?.trim() ? { title: detail.title.trim() } : {}),
      ...(shouldOpenChatFirstBrowserExternally(url.href)
        ? { openExternally: true }
        : {}),
    },
  };
}

type ChatFirstOpenAppListener = (detail: ChatFirstOpenAppDetail) => void;
const chatFirstOpenAppListeners = new Set<symbol>();
type ChatFirstOpenBrowserListener = (
  detail: ChatFirstOpenBrowserDetail,
) => void;
const chatFirstOpenBrowserListeners = new Set<symbol>();

function normalizeSessionId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return id || null;
}

/** Resolve ids from run/thread payloads without treating an absent id as a session. */
export function resolveChatFirstSessionId(value: unknown): string | null {
  if (typeof value === "string") return normalizeSessionId(value);
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["sessionId", "runId", "threadId", "id"]) {
    const id = normalizeSessionId(record[key]);
    if (id) return id;
  }
  return null;
}

export function normalizeChatFirstSessionReference(
  value: unknown,
): ChatFirstSessionReference | null {
  const sessionId = resolveChatFirstSessionId(value);
  if (!sessionId) return null;
  if (!value || typeof value !== "object") return { sessionId };
  const record = value as Record<string, unknown>;
  const title = normalizeSessionId(record.title);
  const goalId = normalizeSessionId(record.goalId);
  const sourceSessionId = normalizeSessionId(record.sourceSessionId);
  const kind =
    record.kind === "code-agent" ||
    record.kind === "agent-chat" ||
    record.kind === "external"
      ? record.kind
      : undefined;
  return {
    sessionId,
    ...(title ? { title } : {}),
    ...(kind ? { kind } : {}),
    ...(goalId ? { goalId } : {}),
    ...(sourceSessionId ? { sourceSessionId } : {}),
  };
}

function createChatFirstSessionWatchStore(): ChatFirstSessionWatchStore {
  let state: ChatFirstSessionWatchState = { target: null };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hasSubscribers: () => listeners.size > 0,
    open: (target) => {
      state = { target };
      listeners.forEach((listener) => listener());
    },
    close: () => {
      if (!state.target) return;
      state = { target: null };
      listeners.forEach((listener) => listener());
    },
  };
}

const chatFirstSessionWatchStore = createChatFirstSessionWatchStore();

export function getChatFirstSessionWatchStore(): ChatFirstSessionWatchStore {
  return chatFirstSessionWatchStore;
}

export function useChatFirstSessionWatch(): ChatFirstSessionWatchState {
  return useSyncExternalStore(
    chatFirstSessionWatchStore.subscribe,
    chatFirstSessionWatchStore.getSnapshot,
    chatFirstSessionWatchStore.getSnapshot,
  );
}

export function subscribeChatFirstSessionWatch(
  listener: (target: ChatFirstSessionReference) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  listenersForWatch += 1;
  const handleEvent = (event: Event) => {
    const target = normalizeChatFirstSessionReference(
      (event as CustomEvent<ChatFirstSessionReference>).detail,
    );
    if (target) listener(target);
  };
  window.addEventListener(CHAT_FIRST_WATCH_SESSION_EVENT, handleEvent);
  return () => {
    listenersForWatch = Math.max(0, listenersForWatch - 1);
    window.removeEventListener(CHAT_FIRST_WATCH_SESSION_EVENT, handleEvent);
  };
}

export function emitChatFirstSessionWatch(
  detail: unknown,
): ChatFirstSessionWatchDelivery {
  const target = normalizeChatFirstSessionReference(detail);
  if (!target) return { delivered: false, reason: "empty-detail" };
  const delivered =
    chatFirstSessionWatchStore.hasSubscribers() || listenersForWatch > 0;
  chatFirstSessionWatchStore.open(target);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<ChatFirstSessionReference>(
        CHAT_FIRST_WATCH_SESSION_EVENT,
        { detail: target },
      ),
    );
  }
  return delivered
    ? { delivered: true }
    : { delivered: false, reason: "no-listener" };
}

let listenersForWatch = 0;

export function closeChatFirstSessionWatch(): void {
  chatFirstSessionWatchStore.close();
}

function readChatFirstSurfaceTabsState(
  scope: string,
): ChatFirstSurfaceTabsState {
  const storage = browserStorage();
  if (!storage) return { tabs: [], activeTabId: null };
  try {
    const raw = storage.getItem(CHAT_FIRST_SURFACE_TABS_STORAGE_KEY);
    if (!raw) return { tabs: [], activeTabId: null };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { tabs: [], activeTabId: null };
    }
    const scoped = (parsed as Record<string, unknown>)[scope];
    if (!scoped || typeof scoped !== "object") {
      return { tabs: [], activeTabId: null };
    }
    const value = scoped as Record<string, unknown>;
    let migratedLegacyPlacement = false;
    const tabs = Array.isArray(value.tabs)
      ? value.tabs.flatMap((candidate) => {
          const tab = normalizePersistedChatFirstSurfaceTab(candidate);
          if (
            tab?.kind === "app" &&
            candidate !== null &&
            typeof candidate === "object" &&
            !("placement" in candidate)
          ) {
            migratedLegacyPlacement = true;
          }
          return tab ? [tab] : [];
        })
      : [];
    const activeTabId =
      typeof value.activeTabId === "string" &&
      tabs.some((tab) => tab.id === value.activeTabId)
        ? value.activeTabId
        : (tabs[0]?.id ?? null);
    const state = { tabs, activeTabId };
    if (migratedLegacyPlacement) writeChatFirstSurfaceTabsState(scope, state);
    return state;
  } catch {
    return { tabs: [], activeTabId: null };
  }
}

function normalizePersistedChatFirstSurfaceTab(
  candidate: unknown,
): ChatFirstSurfaceTab | null {
  if (!candidate || typeof candidate !== "object") return null;
  const value = candidate as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const kind = value.kind;
  if (
    !id ||
    !title ||
    typeof kind !== "string" ||
    !CHAT_FIRST_SURFACE_KINDS.includes(kind as ChatFirstSurfaceKind)
  ) {
    return null;
  }

  const tab = value as unknown as ChatFirstSurfaceTab;
  if (kind === "app") {
    const appId = typeof value.appId === "string" ? value.appId.trim() : "";
    if (!appId) return null;
    const placement = value.placement;
    if (
      placement !== undefined &&
      placement !== "main" &&
      placement !== "side"
    ) {
      return null;
    }
    if (
      value.path !== undefined &&
      (typeof value.path !== "string" || normalizedPath(value.path) === null)
    ) {
      return null;
    }
    return {
      ...tab,
      id,
      title,
      appId,
      placement: placement ?? "main",
    };
  }
  if (kind === "browser") {
    const url = typeof value.url === "string" ? value.url.trim() : "";
    const parsed = parseAbsoluteHttpUrl(url);
    if (!parsed || parsed.username || parsed.password) return null;
    return { ...tab, id, title, url: parsed.href };
  }
  if (kind === "side-chat") {
    const session = normalizeChatFirstSessionReference(value.session);
    return session ? { ...tab, id, title, session } : null;
  }
  return { ...tab, id, title, kind: kind as ChatFirstSurfaceKind };
}

function writeChatFirstSurfaceTabsState(
  scope: string,
  state: ChatFirstSurfaceTabsState,
): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    const raw = storage.getItem(CHAT_FIRST_SURFACE_TABS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    const all =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    storage.setItem(
      CHAT_FIRST_SURFACE_TABS_STORAGE_KEY,
      JSON.stringify({ ...all, [scope]: state }),
    );
    // coercion-ok: device-local tab restoration failure leaves the live tab store usable.
  } catch {
    // Device-local tab restoration is optional; the live store remains usable.
  }
}

function createChatFirstSurfaceTabsStore(
  scope: string,
): ChatFirstSurfaceTabsStore {
  let state = readChatFirstSurfaceTabsState(scope);
  const listeners = new Set<() => void>();
  const publish = (next: ChatFirstSurfaceTabsState) => {
    state = next;
    writeChatFirstSurfaceTabsState(scope, state);
    listeners.forEach((listener) => listener());
  };
  const activeIndex = (tabId: string) =>
    state.tabs.findIndex((tab) => tab.id === tabId);

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open: (tab) => {
      const existingIndex = activeIndex(tab.id);
      if (existingIndex >= 0) {
        const tabs = state.tabs.map((current, index) =>
          index === existingIndex ? tab : current,
        );
        publish({ tabs, activeTabId: tab.id });
        return;
      }
      publish({
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
      });
    },
    activate: (tabId) => {
      if (activeIndex(tabId) < 0 || state.activeTabId === tabId) return;
      publish({ ...state, activeTabId: tabId });
    },
    close: (tabId) => {
      const index = activeIndex(tabId);
      if (index < 0) return;
      const tabs = state.tabs.filter((tab) => tab.id !== tabId);
      const activeTabId =
        state.activeTabId !== tabId
          ? state.activeTabId
          : (tabs[index - 1]?.id ?? tabs[index]?.id ?? null);
      publish({ tabs, activeTabId });
    },
    closeOthers: (tabId) => {
      if (activeIndex(tabId) < 0) return;
      const tab = state.tabs.find((candidate) => candidate.id === tabId);
      if (!tab) return;
      publish({ tabs: [tab], activeTabId: tab.id });
    },
    closeToRight: (tabId) => {
      const index = activeIndex(tabId);
      if (index < 0) return;
      const tabs = state.tabs.slice(0, index + 1);
      const activeTabId = tabs.some((tab) => tab.id === state.activeTabId)
        ? state.activeTabId
        : (tabs[index]?.id ?? null);
      publish({ tabs, activeTabId });
    },
    closeAll: () => publish({ tabs: [], activeTabId: null }),
  };
}

const chatFirstSurfaceTabsStores = new Map<string, ChatFirstSurfaceTabsStore>();

function normalizedSurfaceScope(scope: string): string {
  const value = scope.trim();
  return value || "default";
}

export function getChatFirstSurfaceTabsStore(
  scope = "default",
): ChatFirstSurfaceTabsStore {
  const key = normalizedSurfaceScope(scope);
  const existing = chatFirstSurfaceTabsStores.get(key);
  if (existing) return existing;
  const store = createChatFirstSurfaceTabsStore(key);
  chatFirstSurfaceTabsStores.set(key, store);
  return store;
}

export function useChatFirstSurfaceTabs(
  scope = "default",
): ChatFirstSurfaceTabsState {
  const store = getChatFirstSurfaceTabsStore(scope);
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}

export function subscribeChatFirstOpenApp(
  listener: ChatFirstOpenAppListener,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const subscription = Symbol("chat-first-open-app");
  const handleEvent = (event: Event) => {
    const detail = (event as CustomEvent<ChatFirstOpenAppDetail>).detail;
    if (detail && typeof detail === "object") listener(detail);
  };
  chatFirstOpenAppListeners.add(subscription);
  window.addEventListener(CHAT_FIRST_OPEN_APP_EVENT, handleEvent);
  return () => {
    chatFirstOpenAppListeners.delete(subscription);
    window.removeEventListener(CHAT_FIRST_OPEN_APP_EVENT, handleEvent);
  };
}

export function emitChatFirstOpenApp(
  detail: ChatFirstOpenAppDetail,
): ChatFirstOpenAppDelivery {
  if (!detail.app && !detail.url && !detail.path && !detail.view) {
    return { delivered: false, reason: "empty-detail" };
  }
  if (typeof window === "undefined") {
    return { delivered: false, reason: "no-listener" };
  }
  const delivered = chatFirstOpenAppListeners.size > 0;
  window.dispatchEvent(
    new CustomEvent<ChatFirstOpenAppDetail>(CHAT_FIRST_OPEN_APP_EVENT, {
      detail,
    }),
  );
  return delivered
    ? { delivered: true }
    : { delivered: false, reason: "no-listener" };
}

export function subscribeChatFirstOpenBrowser(
  listener: ChatFirstOpenBrowserListener,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const subscription = Symbol("chat-first-open-browser");
  const handleEvent = (event: Event) => {
    const detail = (event as CustomEvent<ChatFirstOpenBrowserDetail>).detail;
    if (detail && typeof detail === "object") listener(detail);
  };
  chatFirstOpenBrowserListeners.add(subscription);
  window.addEventListener(CHAT_FIRST_OPEN_BROWSER_EVENT, handleEvent);
  return () => {
    chatFirstOpenBrowserListeners.delete(subscription);
    window.removeEventListener(CHAT_FIRST_OPEN_BROWSER_EVENT, handleEvent);
  };
}

export function emitChatFirstOpenBrowser(
  detail: ChatFirstOpenBrowserDetail,
): ChatFirstOpenAppDelivery {
  if (!detail.url?.trim()) {
    return { delivered: false, reason: "empty-detail" };
  }
  if (typeof window === "undefined") {
    return { delivered: false, reason: "no-listener" };
  }
  const delivered = chatFirstOpenBrowserListeners.size > 0;
  window.dispatchEvent(
    new CustomEvent<ChatFirstOpenBrowserDetail>(CHAT_FIRST_OPEN_BROWSER_EVENT, {
      detail,
    }),
  );
  return delivered
    ? { delivered: true }
    : { delivered: false, reason: "no-listener" };
}

function normalizedPath(value: string | null | undefined): string | null {
  const path = value?.trim();
  if (!path || !path.startsWith("/") || path.startsWith("//")) return null;
  if (path.startsWith("/\\") || /[\u0000-\u001f\u007f]/.test(path)) {
    return null;
  }
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(path)) return null;
  if (path.split(/[?#]/, 1)[0]?.split("/").includes("..")) return null;
  return path;
}

function parseAbsoluteHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
    // coercion-ok: invalid URL input is returned as null and rejected by the resolver.
  } catch {
    return null;
  }
}

/**
 * Builder's web app sends frame-blocking headers. Its branch/editor URLs are
 * open-browser targets, not the iframe-backed Fusion preview URLs served from
 * builder.cloud, so keep them out of the chat-first browser iframe.
 */
export function shouldOpenChatFirstBrowserExternally(value: string): boolean {
  const url = parseAbsoluteHttpUrl(value);
  return Boolean(
    url &&
    (url.hostname === "builder.io" || url.hostname.endsWith(".builder.io")),
  );
}

function registrationUrls(
  app: ChatFirstAppRegistration,
  currentOrigin?: string,
): URL[] {
  const values = [app.url, app.devUrl];
  if (app.path && currentOrigin) values.push(`${currentOrigin}${app.path}`);
  return values.flatMap((value) => {
    if (!value) return [];
    const absolute = parseAbsoluteHttpUrl(value);
    if (absolute) return [absolute];
    if (value.startsWith("/") && currentOrigin) {
      const relative = parseAbsoluteHttpUrl(`${currentOrigin}${value}`);
      return relative ? [relative] : [];
    }
    return [];
  });
}

function appMatchesUrl(
  app: ChatFirstAppRegistration,
  targetUrl: URL,
  currentOrigin?: string,
): URL | null {
  for (const registeredUrl of registrationUrls(app, currentOrigin)) {
    if (registeredUrl.origin !== targetUrl.origin) continue;
    const basePath = registeredUrl.pathname.replace(/\/+$/, "") || "/";
    if (
      basePath !== "/" &&
      targetUrl.pathname !== basePath &&
      !targetUrl.pathname.startsWith(`${basePath}/`)
    ) {
      continue;
    }
    return registeredUrl;
  }
  return null;
}

function appRelativeUrlPath(targetUrl: URL, registeredUrl: URL): string {
  const basePath = registeredUrl.pathname.replace(/\/+$/, "") || "/";
  const pathname =
    basePath === "/"
      ? targetUrl.pathname
      : targetUrl.pathname === basePath
        ? "/"
        : targetUrl.pathname.slice(basePath.length) || "/";
  return `${pathname}${targetUrl.search}${targetUrl.hash}`;
}

function viewPath(appId: string, view: string): string {
  const params = new URLSearchParams({ app: appId, view });
  return `/_agent-native/open?${params.toString()}`;
}

export function resolveChatFirstAppTarget(
  detail: ChatFirstOpenAppDetail,
  apps: readonly ChatFirstAppRegistration[],
  options: { currentOrigin?: string } = {},
): ChatFirstAppResolution {
  if (!detail.app && !detail.url && !detail.path && !detail.view) {
    return { status: "unresolved", reason: "empty-detail" };
  }

  const availableApps = apps.filter((app) => app.enabled !== false);
  const requestedId = detail.app?.trim().toLowerCase();
  let app = requestedId
    ? availableApps.find(
        (candidate) =>
          candidate.id.toLowerCase() === requestedId ||
          candidate.name?.trim().toLowerCase() === requestedId,
      )
    : undefined;

  const rawUrl = detail.url?.trim();
  let targetUrl: URL | null = null;
  if (rawUrl) {
    targetUrl = parseAbsoluteHttpUrl(rawUrl);
    if (!targetUrl) {
      const relativePath = normalizedPath(rawUrl);
      if (!app || !relativePath) {
        return { status: "unresolved", reason: "invalid-url" };
      }
    }
  }

  if (targetUrl) {
    if (app) {
      const registeredUrl = appMatchesUrl(
        app,
        targetUrl,
        options.currentOrigin,
      );
      if (!registeredUrl) {
        return { status: "unresolved", reason: "invalid-url" };
      }
    } else {
      const matchingApp = availableApps
        .map((candidate) => ({
          app: candidate,
          registeredUrl: appMatchesUrl(
            candidate,
            targetUrl as URL,
            options.currentOrigin,
          ),
        }))
        .find((candidate) => candidate.registeredUrl);
      if (!matchingApp) {
        return { status: "unresolved", reason: "unknown-app" };
      }
      app = matchingApp.app;
    }
  }

  if (!app) return { status: "unresolved", reason: "unknown-app" };

  let path: string | undefined;
  if (targetUrl) {
    const registeredUrl = appMatchesUrl(app, targetUrl, options.currentOrigin);
    if (!registeredUrl) {
      return { status: "unresolved", reason: "invalid-url" };
    }
    path = appRelativeUrlPath(targetUrl, registeredUrl);
  } else if (rawUrl) {
    path = normalizedPath(rawUrl) ?? undefined;
  } else if (detail.path) {
    path = normalizedPath(detail.path) ?? undefined;
    if (!path) return { status: "unresolved", reason: "invalid-url" };
  } else if (detail.view?.trim()) {
    path = viewPath(app.id, detail.view.trim());
  }

  return {
    status: "ready",
    target: {
      appId: app.id,
      ...(path ? { path } : {}),
      ...(detail.view?.trim() ? { view: detail.view.trim() } : {}),
    },
  };
}
