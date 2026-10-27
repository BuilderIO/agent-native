import {
  hideChatThread,
  useChatThreadList,
  type ChatThreadListRow,
  type ChatThreadScope,
  type UseChatThreadListOptions,
} from "@agent-native/core/client/agent-chat";
import { agentNativePath } from "@agent-native/core/client/api-path";
import {
  DEFAULT_LOCALE,
  useOptionalLocale,
  useT,
} from "@agent-native/core/client/i18n";
import type { ChatHistoryItem } from "@agent-native/toolkit/chat-history/ChatHistoryList";
import type { ChatHistoryRailSection } from "@agent-native/toolkit/chat-history/ChatHistoryRail";
import type { ChatHistoryRailSectionControllerLabels } from "@agent-native/toolkit/chat-history/useChatHistoryRailController";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { useChatUnreadThreads } from "../run-awareness/chat-unread-state.js";
import {
  chatThreadToHistoryItem,
  ownDraftToHistoryItem,
  type OwnDraftRow,
} from "./rows.js";

export type OwnershipChatHistoryMutationKind = "pin" | "rename" | "archive";
export type OwnershipChatHistorySection = "pinned" | "mine" | "shared";

export interface UseOwnershipChatHistoryOptions extends Omit<
  UseChatThreadListOptions,
  "ownership"
> {
  activeId?: string | null;
  minePreviewCount?: number;
  sharedPreviewCount?: number;
  pinned?: boolean | { label?: ReactNode };
  localMineRows?: readonly OwnDraftRow[];
  decorateItem?: (
    item: ChatHistoryItem,
    row: ChatThreadListRow | OwnDraftRow,
    context: { section: OwnershipChatHistorySection },
  ) => ChatHistoryItem;
  mutations?: {
    pin?: (id: string, pinned: boolean) => Promise<boolean>;
    rename?: (id: string, title: string) => Promise<boolean>;
    archive?: (id: string) => Promise<boolean>;
  };
  /**
   * The URL that opens a thread, resolved against the current page; enables
   * Copy link on every row. Router paths need `appPath()` for the base path.
   */
  getThreadUrl?: (id: string) => string;
  onMutationFailed?: (
    kind: OwnershipChatHistoryMutationKind,
    id: string,
    cause?: unknown,
  ) => void;
}

export interface OwnershipChatHistoryListProps {
  onTogglePin?: (id: string) => Promise<boolean>;
  onRename?: (id: string, title: string) => Promise<boolean>;
  onDelete?: (id: string) => Promise<boolean>;
  deleteAction?: "archive";
  onCopyLink?: (id: string) => Promise<void>;
  /** Hides a shared chat from the viewer's lists; its toast offers Undo. */
  onHide?: (id: string) => Promise<boolean>;
}

export interface UseOwnershipChatHistoryResult {
  sections: ChatHistoryRailSection[];
  railLabels: { sections: ChatHistoryRailSectionControllerLabels };
  listProps: OwnershipChatHistoryListProps;
  mineRows: ChatThreadListRow[];
  sharedRows: ChatThreadListRow[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  findMine: (id: string) => ChatThreadListRow | OwnDraftRow | undefined;
}

interface OverrideValues {
  title: string;
  pinned: boolean;
  hidden: boolean;
}

interface FieldIntent<Value> {
  token: number;
  value: Value;
  mineAtStart: readonly ChatThreadListRow[];
  sharedAtStart: readonly ChatThreadListRow[];
}

interface FieldState<Value> {
  latestToken: number;
  inFlight: ReadonlyMap<number, FieldIntent<Value>>;
  // A reconciled success remains a watermark until older writes finish.
  successful?: { intent: FieldIntent<Value>; reconciled: boolean };
}

interface HideTarget {
  apiUrl: string;
  scope?: ChatThreadScope;
}

type OverrideField = keyof OverrideValues;
type Override = {
  [Field in OverrideField]?: FieldState<OverrideValues[Field]>;
};

const OVERRIDE_FIELDS = ["title", "pinned", "hidden"] as const;

function isShared(row: ChatThreadListRow | OwnDraftRow | undefined) {
  return !!row && "accessBasis" in row && row.accessBasis !== "owner";
}

function isPersistedOwner(row: ChatThreadListRow | OwnDraftRow | undefined) {
  return (
    !!row &&
    ("accessBasis" in row
      ? row.accessBasis === "owner"
      : row.persisted === true)
  );
}

// Accepted writes outlive views, including a replacement mount for this resource.
const writeTails = new Map<string, Promise<void>>();

function persistInOrder(key: string, persist: () => Promise<boolean>) {
  const previous = writeTails.get(key);
  let release!: () => void;
  const tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  writeTails.set(key, tail);
  const run = async () => {
    try {
      return await persist();
    } finally {
      if (writeTails.get(key) === tail) writeTails.delete(key);
      release();
    }
  };
  return previous ? previous.then(run) : run();
}

function projectedIntent<Value>(state: FieldState<Value> | undefined) {
  if (!state) return undefined;
  let pending: FieldIntent<Value> | undefined;
  const watermark = state.successful?.intent.token ?? -Infinity;
  for (const intent of state.inFlight.values()) {
    if (intent.token > watermark && (!pending || intent.token > pending.token))
      pending = intent;
  }
  return (
    pending ??
    (state.successful?.reconciled ? undefined : state.successful?.intent)
  );
}

function successfulIntents(rows: ReadonlyMap<string, Override>) {
  return [...rows].flatMap(([id, override]) =>
    OVERRIDE_FIELDS.flatMap((field) => {
      const successful = override[field]?.successful;
      return successful && !successful.reconciled
        ? [{ id, field, intent: successful.intent }]
        : [];
    }),
  );
}

function withField<Field extends OverrideField>(
  rows: Map<string, Override>,
  id: string,
  field: Field,
  state: FieldState<OverrideValues[Field]>,
): Map<string, Override> {
  const remaining = { ...rows.get(id), [field]: state };
  if (
    state.inFlight.size === 0 &&
    (!state.successful || state.successful.reconciled)
  )
    delete remaining[field];
  const next = new Map(rows);
  if (OVERRIDE_FIELDS.some((field) => remaining[field]))
    next.set(id, remaining);
  else next.delete(id);
  return next;
}

function reconcileIntent(
  rows: Map<string, Override>,
  id: string,
  field: OverrideField,
  token: number,
): Map<string, Override> {
  const state = rows.get(id)?.[field];
  if (state?.successful?.intent.token !== token) return rows;
  return withField(rows, id, field, {
    ...state,
    successful: { ...state.successful, reconciled: true },
  });
}

function matches(
  id: string,
  field: OverrideField,
  intent: FieldIntent<string | boolean>,
  mine: readonly ChatThreadListRow[],
  shared: readonly ChatThreadListRow[],
): boolean {
  const owned = mine.find((row) => row.id === id);
  if (field === "hidden") {
    if (mine === intent.mineAtStart || shared === intent.sharedAtStart)
      return false;
    const listed = !!owned || shared.some((row) => row.id === id);
    return intent.value ? !listed : listed;
  }
  const row = owned ?? shared.find((row) => row.id === id);
  if (
    !row ||
    (owned ? mine === intent.mineAtStart : shared === intent.sharedAtStart)
  )
    return false;
  return field === "title"
    ? intent.value === row.title
    : intent.value === (row.pinnedAt != null);
}

export function useOwnershipChatHistory(
  options: UseOwnershipChatHistoryOptions = {},
): UseOwnershipChatHistoryResult {
  const {
    apiUrl,
    scope,
    includeExternal,
    query,
    pageSize,
    enabled = true,
    activeId,
    pinned,
    localMineRows,
    decorateItem,
    minePreviewCount = 5,
    sharedPreviewCount = 5,
  } = options;
  const endpoint = apiUrl ?? agentNativePath("/_agent-native/agent-chat");
  const normalizedQuery = query?.trim() ?? "";
  const listOptions = {
    apiUrl: endpoint,
    scope,
    includeExternal,
    query: normalizedQuery,
    pageSize,
    enabled,
    refreshOnThreadUpdates: false,
  };
  const mine = useChatThreadList({ ...listOptions, ownership: "mine" });
  const shared = useChatThreadList({ ...listOptions, ownership: "shared" });
  const { unreadThreadIds } = useChatUnreadThreads({ enabled });
  const t = useT();
  const locale = useOptionalLocale()?.locale ?? DEFAULT_LOCALE;
  const scopeKey = JSON.stringify([
    endpoint,
    scope?.type,
    scope?.id,
    includeExternal,
    normalizedQuery,
    pageSize,
    enabled,
  ]);
  const generation = useMemo(
    () => ({
      view: null as { active: boolean } | null,
      rows: new Map<string, Override>(),
      dirty: false,
      needsRefresh: false,
      inFlight: 0,
      writes: 0,
      threadUpdates: false,
      lastRefresh: -Infinity,
    }),
    [scopeKey],
  );
  const generationRef = useRef(generation);
  generationRef.current = generation;
  const [revision, publish] = useState(0);
  const overrides = generation.rows;
  const tokenRef = useRef(0);
  // Undo can outlive the view that hid the row, e.g. after a search change.
  const hiddenShared = useRef(
    new Map<string, { row: ChatThreadListRow; index: number; view: string }>(),
  );
  const unhideRef = useRef<
    (id: string, target: HideTarget) => Promise<boolean>
  >(async () => false);
  const latest = useRef({ mine, shared, options });
  latest.current = { mine, shared, options };

  const current = useCallback(
    () =>
      generation.view?.active === true && generationRef.current === generation,
    [generation],
  );
  const updateOverrides = useCallback(
    (update: (rows: Map<string, Override>) => Map<string, Override>) => {
      // Activity detaches effects without releasing this generation's mutations.
      const next = update(generation.rows);
      if (next === generation.rows) return;
      generation.rows = next;
      if (current()) publish((value) => value + 1);
      else generation.dirty = true;
    },
    [current, generation],
  );

  useLayoutEffect(() => {
    // Reactivation must not revive permission for pre-hide continuations.
    const view = { active: true };
    generation.view = view;
    if (generation.dirty) {
      generation.dirty = false;
      publish((value) => value + 1);
    }
    if (successfulIntents(generation.rows).length)
      generation.needsRefresh = true;
    return () => {
      view.active = false;
    };
  }, [generation]);

  const refreshWithResults = useCallback(async () => {
    if (!enabled || !current()) return ["disabled", "disabled"] as const;
    const view = generation.view;
    const settled = successfulIntents(generation.rows);
    generation.threadUpdates = false;
    generation.inFlight += 1;
    try {
      const outcomes = await Promise.all([
        latest.current.mine.refreshWithResult(),
        latest.current.shared.refreshWithResult(),
      ]);
      if (
        current() &&
        generation.view === view &&
        settled.length &&
        outcomes.every((outcome) => outcome === "success")
      ) {
        updateOverrides((rows) => {
          let next = rows;
          for (const { id, field, intent } of settled) {
            next = reconcileIntent(next, id, field, intent.token);
          }
          return next;
        });
      }
      return outcomes;
    } finally {
      generation.inFlight -= 1;
      generation.lastRefresh = Date.now();
      if (
        current() &&
        (generation.needsRefresh || generation.threadUpdates) &&
        generation.inFlight === 0
      )
        publish((value) => value + 1);
    }
  }, [current, enabled, generation, updateOverrides]);
  // The list reports one error for any failed request, so remember which kind
  // of request the user last asked for to name the failure correctly.
  const loadingMoreRef = useRef({ mine: false, shared: false });
  const refresh = useCallback(async () => {
    loadingMoreRef.current = { mine: false, shared: false };
    await refreshWithResults();
  }, [refreshWithResults]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const refreshIfDue = () => {
      if (generation.inFlight || Date.now() - generation.lastRefresh < 10_000)
        return;
      void refresh();
    };
    const onRunEnd = (event: Event) => {
      if (
        (event as CustomEvent<{ isRunning?: boolean }>).detail?.isRunning ===
        false
      )
        refreshIfDue();
    };
    const onUpdated = () => {
      generation.threadUpdates = true;
      if (!generation.writes && !generation.inFlight) void refresh();
    };
    window.addEventListener("focus", refreshIfDue);
    window.addEventListener("agentNative.chatRunning", onRunEnd);
    window.addEventListener("agent-chat:threads-updated", onUpdated);
    return () => {
      window.removeEventListener("focus", refreshIfDue);
      window.removeEventListener("agentNative.chatRunning", onRunEnd);
      window.removeEventListener("agent-chat:threads-updated", onUpdated);
    };
  }, [enabled, generation, refresh]);

  useEffect(() => {
    if (mine.error || shared.error) return;
    const reconciled = successfulIntents(generation.rows).filter(
      ({ id, field, intent }) =>
        matches(id, field, intent, mine.threads, shared.threads),
    );
    if (reconciled.length === 0) return;
    updateOverrides((rows) => {
      let next = rows;
      for (const { id, field, intent } of reconciled) {
        next = reconcileIntent(next, id, field, intent.token);
      }
      return next;
    });
  }, [
    mine.threads,
    shared.threads,
    mine.error,
    shared.error,
    generation,
    updateOverrides,
  ]);

  useEffect(() => {
    if (
      !enabled ||
      !current() ||
      (!generation.needsRefresh && !generation.threadUpdates) ||
      generation.inFlight ||
      generation.writes
    )
      return;
    const needsRefresh =
      generation.threadUpdates || successfulIntents(generation.rows).length > 0;
    generation.needsRefresh = false;
    if (needsRefresh) void refreshWithResults();
  }, [current, enabled, generation, refreshWithResults, revision]);

  const mineRows = enabled ? mine.threads : [];
  const mineIds = new Set(mineRows.map((row) => row.id));
  const sharedRows = enabled
    ? shared.threads.filter((row) => !mineIds.has(row.id))
    : [];
  const serverIds = new Set([...mineRows, ...sharedRows].map((row) => row.id));
  const drafts = enabled
    ? (localMineRows ?? []).filter((row) => !serverIds.has(row.id))
    : [];
  const findMine = (id: string) =>
    mineRows.find((row) => row.id === id && row.accessBasis === "owner") ??
    drafts.find((row) => row.id === id);

  const findShared = (id: string) => sharedRows.find((row) => row.id === id);
  // Rename and archive stay with the owner; pin and hide are the viewer's own.
  const permits = (
    kind: OwnershipChatHistoryMutationKind | "hide",
    id: string,
  ) =>
    kind === "hide"
      ? !!findShared(id) || hiddenShared.current.has(id)
      : isPersistedOwner(findMine(id)) || (kind === "pin" && !!findShared(id));

  const mutate = async <Field extends OverrideField>(
    kind: OwnershipChatHistoryMutationKind | "hide",
    id: string,
    field: Field,
    value: OverrideValues[Field],
    persist: () => Promise<boolean>,
    failed: (...cause: [] | [unknown]) => void = (...cause) => {
      if (kind !== "hide")
        latest.current.options.onMutationFailed?.(kind, id, ...cause);
    },
  ) => {
    if (!enabled || !current() || !permits(kind, id)) return false;
    const view = generation.view;
    const permitted = () => current() && generation.view === view;
    const token = ++tokenRef.current;
    generation.writes += 1;
    const intent = {
      value,
      token,
      mineAtStart: mine.threads,
      sharedAtStart: shared.threads,
    };
    updateOverrides((rows) => {
      const state = rows.get(id)?.[field];
      return withField(rows, id, field, {
        ...state,
        latestToken: token,
        inFlight: new Map(state?.inFlight).set(token, intent),
      });
    });
    const complete = (succeeded: boolean) => {
      generation.writes -= 1;
      let isLatest = false;
      updateOverrides((rows) => {
        const state = rows.get(id)?.[field];
        if (!state?.inFlight.has(token))
          throw new Error("Chat history mutation lost its in-flight intent.");
        isLatest = state.latestToken === token;
        const inFlight = new Map(state.inFlight);
        inFlight.delete(token);
        const successful =
          succeeded &&
          (!state.successful || token > state.successful.intent.token)
            ? { intent, reconciled: false }
            : state.successful;
        return withField(rows, id, field, { ...state, inFlight, successful });
      });
      return isLatest;
    };
    let succeeded: boolean;
    try {
      succeeded = await persistInOrder(
        JSON.stringify([endpoint, id, field]),
        persist,
      );
    } catch (cause) {
      const isLatest = complete(false);
      if (permitted() && isLatest) failed(cause);
      return false;
    }
    if (!succeeded) {
      const isLatest = complete(false);
      if (permitted() && isLatest) failed();
      return false;
    }
    complete(true);
    if (!permitted()) {
      generation.needsRefresh = true;
      if (current()) publish((value) => value + 1);
      return false;
    }
    const successful = generation.rows.get(id)?.[field]?.successful;
    if (
      successful?.intent.token === token &&
      matches(
        id,
        field,
        successful.intent,
        latest.current.mine.threads,
        latest.current.shared.threads,
      ) &&
      !latest.current.mine.error &&
      !latest.current.shared.error
    ) {
      updateOverrides((rows) => reconcileIntent(rows, id, field, token));
      return true;
    }
    // This request starts after persistence; an earlier notification can still
    // be returning the pre-mutation window when the mutation resolves.
    await refreshWithResults();
    if (!permitted()) {
      generation.needsRefresh = true;
      if (current()) publish((value) => value + 1);
    }
    return permitted();
  };

  const listProps: OwnershipChatHistoryListProps = {};
  if (options.mutations?.pin)
    listProps.onTogglePin = async (id) => {
      const persist = options.mutations!.pin!;
      const row = findMine(id) ?? findShared(id);
      if (!row) return false;
      const nextPinned = !(
        projectedIntent(generation.rows.get(id)?.pinned)?.value ??
        ("pinnedAt" in row && row.pinnedAt != null)
      );
      return mutate("pin", id, "pinned", nextPinned, () =>
        persist(id, nextPinned),
      );
    };
  if (options.mutations?.rename)
    listProps.onRename = (id, title) => {
      const persist = options.mutations!.rename!;
      const nextTitle = title.replace(/\s+/g, " ").trim().slice(0, 160);
      return mutate("rename", id, "title", nextTitle, () =>
        persist(id, nextTitle),
      );
    };
  if (options.mutations?.archive) {
    listProps.onDelete = (id) => {
      const persist = options.mutations!.archive!;
      return mutate("archive", id, "hidden", true, () => persist(id));
    };
    listProps.deleteAction = "archive";
  }
  const setHidden = (
    id: string,
    hidden: boolean,
    target: HideTarget,
    failed: (...cause: [] | [unknown]) => void,
  ) =>
    mutate(
      "hide",
      id,
      "hidden",
      hidden,
      () => hideChatThread(id, hidden, target),
      failed,
    );
  // Undo goes to the scope that hid the chat, and its toast outlives this
  // view, so a closed view sends the request itself.
  unhideRef.current = async (id, target) => {
    const failed = () => toast.error(t("agentChat.history.unhideFailed"));
    if (current()) return setHidden(id, false, target, failed);
    let unhidden: boolean;
    try {
      unhidden = await persistInOrder(
        JSON.stringify([target.apiUrl, id, "hidden"]),
        () => hideChatThread(id, false, target),
      );
    } catch {
      unhidden = false;
    }
    if (!unhidden) failed();
    return unhidden;
  };
  listProps.onHide = (id) => {
    const row = findShared(id);
    if (!row) return Promise.resolve(false);
    hiddenShared.current.set(id, {
      row,
      index: sharedRows.indexOf(row),
      view: scopeKey,
    });
    const target = { apiUrl: endpoint, ...(scope ? { scope } : {}) };
    const notice = toast(t("agentChat.history.hidden"), {
      action: {
        label: t("agentChat.history.undo"),
        onClick: () => void unhideRef.current(id, target),
      },
    });
    return setHidden(id, true, target, () => {
      toast.dismiss(notice);
      toast.error(t("agentChat.history.hideFailed"));
    });
  };
  if (options.getThreadUrl)
    listProps.onCopyLink = async (id) => {
      const url = new URL(
        options.getThreadUrl!(id),
        window.location.href,
      ).toString();
      if (await writeClipboardText(url))
        toast.success(t("agentChat.history.linkCopied"));
      else toast.error(t("agentChat.history.copyLinkFailed"));
    };

  const mapItem = (
    row: ChatThreadListRow | OwnDraftRow,
    section: OwnershipChatHistorySection,
  ) => {
    const override = overrides.get(row.id);
    const title = projectedIntent(override?.title);
    const pin = projectedIntent(override?.pinned);
    const effectiveRow =
      title || pin
        ? {
            ...row,
            ...(title === undefined ? {} : { title: title.value }),
            ...(pin === undefined
              ? {}
              : {
                  pinnedAt: pin.value
                    ? (("pinnedAt" in row ? row.pinnedAt : null) ?? Date.now())
                    : null,
                }),
          }
        : row;
    const mapped =
      "accessBasis" in effectiveRow
        ? chatThreadToHistoryItem(effectiveRow as ChatThreadListRow, {
            t,
            activeId,
            locale,
          })
        : ownDraftToHistoryItem(effectiveRow, { t, activeId, locale });
    const item = {
      ...mapped,
      ...(pin === undefined ? {} : { pinned: pin.value }),
      ...(unreadThreadIds.has(row.id) ? { unread: true } : {}),
    };
    const decorated = decorateItem?.(item, effectiveRow, { section }) ?? item;
    return isShared(row)
      ? { ...decorated, readOnly: true }
      : isPersistedOwner(row)
        ? decorated
        : { ...decorated, hideActions: true };
  };
  const hiddenIntent = (id: string) =>
    projectedIntent(overrides.get(id)?.hidden)?.value;
  const visibleMine = mineRows.filter((row) => !hiddenIntent(row.id));
  const visibleShared = sharedRows.filter((row) => !hiddenIntent(row.id));
  // Undo shows the row again before the refresh that returns it, but only in
  // the view that hid it; any other view waits for the server.
  for (const [id, { row, index, view }] of hiddenShared.current) {
    if (view === scopeKey && hiddenIntent(id) === false && !serverIds.has(id))
      visibleShared.splice(Math.min(index, visibleShared.length), 0, row);
  }
  const pinIntent = (id: string) => projectedIntent(overrides.get(id)?.pinned);
  // A pin that has no server time yet is the newest one.
  const pinTime = (row: ChatThreadListRow) =>
    pinIntent(row.id) ? Infinity : (row.pinnedAt ?? -Infinity);
  const pinnedRows = pinned
    ? [...visibleMine, ...visibleShared]
        .filter((row) => pinIntent(row.id)?.value ?? row.pinnedAt != null)
        .sort((a, b) =>
          pinTime(a) === pinTime(b) ? 0 : pinTime(a) < pinTime(b) ? 1 : -1,
        )
    : [];
  const pinnedIds = new Set(pinnedRows.map((row) => row.id));
  const sharedItems = visibleShared
    .filter((row) => !pinnedIds.has(row.id))
    .map((row) => mapItem(row, "shared"));
  const mineItems = [
    ...drafts
      .filter((row) => !projectedIntent(overrides.get(row.id)?.hidden)?.value)
      .filter(
        (row) =>
          (
            projectedIntent(overrides.get(row.id)?.title)?.value ??
            row.title ??
            ""
          ).includes(normalizedQuery) ||
          (row.preview ?? "").includes(normalizedQuery),
      )
      .map((row) => mapItem(row, "mine")),
    ...visibleMine
      .filter((row) => !pinnedIds.has(row.id))
      .map((row) => mapItem(row, "mine")),
  ];
  const sectionState = (list: typeof mine, key: "mine" | "shared") => ({
    loading: enabled && list.loading,
    error: list.error
      ? t(
          loadingMoreRef.current[key]
            ? "agentChat.history.loadMoreFailed"
            : list.threads.length
              ? "agentChat.history.refreshFailed"
              : "agentChat.history.loadFailed",
        )
      : undefined,
    onRetry: refresh,
    hasMore: enabled && list.hasMore,
    loadingMore: list.loadingMore,
    onLoadMore: () => {
      loadingMoreRef.current = { ...loadingMoreRef.current, [key]: true };
      return list.loadMore();
    },
  });
  // Both lists fail together when the server is unreachable, and one Retry
  // refreshes both, so the shared section does not repeat the error.
  const sharedErrorShown = Boolean(shared.error) && !mine.error;
  const sections: ChatHistoryRailSection[] = [];
  if (pinnedRows.length)
    sections.push({
      id: "pinned",
      label:
        typeof pinned === "object"
          ? (pinned.label ?? t("agentChat.history.pinned"))
          : t("agentChat.history.pinned"),
      items: pinnedRows.map((row) => mapItem(row, "pinned")),
      previewCount: Math.max(1, pinnedRows.length),
    });
  sections.push({
    id: "mine",
    label: t("agentChat.history.mine"),
    items: mineItems,
    previewCount: minePreviewCount,
    ...sectionState(mine, "mine"),
    emptyLabel:
      pinnedRows.length || mine.hasMore
        ? undefined
        : t("agentChat.history.emptyMine"),
  });
  if (sharedItems.length || sharedErrorShown || (enabled && shared.hasMore))
    sections.push({
      id: "shared",
      label: t("agentChat.history.sharedWithYou"),
      items: sharedItems,
      previewCount: sharedPreviewCount,
      ...sectionState(shared, "shared"),
      ...(sharedErrorShown ? {} : { error: undefined }),
      emptyLabel: shared.hasMore
        ? undefined
        : t("agentChat.history.emptyShared"),
    });
  return {
    sections,
    railLabels: {
      sections: {
        showAll: t("agentChat.history.showAll"),
        showLess: t("agentChat.history.showLess"),
        loadMore: t("agentChat.history.loadMore"),
        loadingMore: t("agentChat.history.loadingMore"),
        retry: t("agentChat.history.retry"),
      },
    },
    listProps,
    mineRows,
    sharedRows,
    loading:
      enabled &&
      mine.loading &&
      shared.loading &&
      mineItems.length === 0 &&
      pinnedRows.length === 0 &&
      sharedRows.length === 0,
    error: mine.error ?? shared.error,
    refresh,
    findMine,
  };
}
