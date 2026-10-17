import {
  useChatThreadList,
  type ChatThreadListRow,
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
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

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

type OverrideField = keyof OverrideValues;
type Override = {
  [Field in OverrideField]?: FieldState<OverrideValues[Field]>;
};

const OVERRIDE_FIELDS = ["title", "pinned", "hidden"] as const;

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
  if (mine === intent.mineAtStart) return false;
  const row = mine.find((row) => row.id === id);
  if (field === "hidden")
    return (
      shared !== intent.sharedAtStart &&
      !row &&
      !shared.some((row) => row.id === id)
    );
  return (
    !!row &&
    (field === "title"
      ? intent.value === row.title
      : intent.value === (row.pinnedAt != null))
  );
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
  const refresh = useCallback(async () => {
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

  const mutate = async <Field extends OverrideField>(
    kind: OwnershipChatHistoryMutationKind,
    id: string,
    field: Field,
    value: OverrideValues[Field],
    persist: () => Promise<boolean>,
  ) => {
    if (!enabled || !current() || !findMine(id)) return false;
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
      if (permitted() && isLatest)
        latest.current.options.onMutationFailed?.(kind, id, cause);
      return false;
    }
    if (!succeeded) {
      const isLatest = complete(false);
      if (permitted() && isLatest)
        latest.current.options.onMutationFailed?.(kind, id);
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
      const row = findMine(id);
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
      return mutate("rename", id, "title", title, () => persist(id, title));
    };
  if (options.mutations?.archive)
    listProps.onDelete = (id) => {
      const persist = options.mutations!.archive!;
      return mutate("archive", id, "hidden", true, () => persist(id));
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
    };
    const decorated = decorateItem?.(item, effectiveRow, { section }) ?? item;
    return section === "shared"
      ? { ...decorated, pinned: false, hideActions: true }
      : decorated;
  };
  const visibleMine = mineRows.filter(
    (row) => !projectedIntent(overrides.get(row.id)?.hidden)?.value,
  );
  const pinnedRows = pinned
    ? visibleMine.filter(
        (row) =>
          projectedIntent(overrides.get(row.id)?.pinned)?.value ??
          row.pinnedAt != null,
      )
    : [];
  const pinnedIds = new Set(pinnedRows.map((row) => row.id));
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
  const sectionState = (list: typeof mine) => ({
    loading: enabled && list.loading,
    error: list.error
      ? t(
          list.threads.length
            ? "agentChat.history.loadMoreFailed"
            : "agentChat.history.loadFailed",
        )
      : undefined,
    onRetry: refresh,
    hasMore: enabled && list.hasMore,
    loadingMore: list.loadingMore,
    onLoadMore: list.loadMore,
  });
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
    ...sectionState(mine),
    emptyLabel:
      pinnedRows.length || mine.hasMore
        ? undefined
        : t("agentChat.history.emptyMine"),
  });
  if (sharedRows.length || shared.error)
    sections.push({
      id: "shared",
      label: t("agentChat.history.sharedWithYou"),
      items: sharedRows.map((row) => mapItem(row, "shared")),
      previewCount: sharedPreviewCount,
      ...sectionState(shared),
      emptyLabel: t("agentChat.history.emptyShared"),
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
