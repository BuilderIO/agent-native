import {
  useChatThreadList,
  type ChatThreadListRow,
  type UseChatThreadListOptions,
} from "@agent-native/core/client/agent-chat";
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

function projectedIntent<Value>(state: FieldState<Value> | undefined) {
  if (!state) return undefined;
  return (
    state.inFlight.get(state.latestToken) ??
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
  const normalizedQuery = query?.trim() ?? "";
  const listOptions = {
    apiUrl,
    scope,
    includeExternal,
    query: normalizedQuery,
    pageSize,
    enabled,
  };
  const mine = useChatThreadList({ ...listOptions, ownership: "mine" });
  const shared = useChatThreadList({ ...listOptions, ownership: "shared" });
  const t = useT();
  const locale = useOptionalLocale()?.locale ?? DEFAULT_LOCALE;
  const scopeKey = JSON.stringify([
    apiUrl,
    scope?.type,
    scope?.id,
    includeExternal,
    normalizedQuery,
    pageSize,
    enabled,
  ]);
  const generation = useMemo(
    () => ({ mounted: true, inFlight: 0, lastRefresh: -Infinity }),
    [scopeKey],
  );
  const generationRef = useRef(generation);
  generationRef.current = generation;
  const [overrideState, setOverrideState] = useState<{
    generation: typeof generation;
    rows: Map<string, Override>;
  }>(() => ({ generation, rows: new Map() }));
  const overrides =
    overrideState.generation === generation
      ? overrideState.rows
      : new Map<string, Override>();
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;
  const tokenRef = useRef(0);
  const latest = useRef({ mine, shared, options });
  latest.current = { mine, shared, options };

  const current = useCallback(
    () => generation.mounted && generationRef.current === generation,
    [generation],
  );
  const updateOverrides = useCallback(
    (update: (rows: Map<string, Override>) => Map<string, Override>) => {
      if (!current()) return;
      const next = update(overridesRef.current);
      overridesRef.current = next;
      setOverrideState({ generation, rows: next });
    },
    [current, generation],
  );

  useEffect(() => {
    generation.mounted = true;
    setOverrideState((state) =>
      state.generation === generation ? state : { generation, rows: new Map() },
    );
    return () => {
      generation.mounted = false;
    };
  }, [generation]);

  const refreshWithResults = useCallback(async () => {
    if (!enabled || !current()) return ["disabled", "disabled"] as const;
    const settled = successfulIntents(overridesRef.current);
    generation.inFlight += 1;
    try {
      const outcomes = await Promise.all([
        latest.current.mine.refreshWithResult(),
        latest.current.shared.refreshWithResult(),
      ]);
      if (
        current() &&
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
    window.addEventListener("focus", refreshIfDue);
    window.addEventListener("agentNative.chatRunning", onRunEnd);
    return () => {
      window.removeEventListener("focus", refreshIfDue);
      window.removeEventListener("agentNative.chatRunning", onRunEnd);
    };
  }, [enabled, generation, refresh]);

  useEffect(() => {
    if (mine.error || shared.error) return;
    const reconciled = successfulIntents(overridesRef.current).filter(
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
  }, [mine.threads, shared.threads, mine.error, shared.error, updateOverrides]);

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
    const token = ++tokenRef.current;
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
      succeeded = await persist();
    } catch (cause) {
      if (!current()) return false;
      if (complete(false))
        latest.current.options.onMutationFailed?.(kind, id, cause);
      return false;
    }
    if (!current()) return false;
    if (!succeeded) {
      if (complete(false)) latest.current.options.onMutationFailed?.(kind, id);
      return false;
    }
    complete(true);
    const successful = overridesRef.current.get(id)?.[field]?.successful;
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
    return current();
  };

  const listProps: OwnershipChatHistoryListProps = {};
  if (options.mutations?.pin)
    listProps.onTogglePin = async (id) => {
      const row = findMine(id);
      if (!row) return false;
      const nextPinned = !(
        projectedIntent(overridesRef.current.get(id)?.pinned)?.value ??
        ("pinnedAt" in row && row.pinnedAt != null)
      );
      return mutate("pin", id, "pinned", nextPinned, () =>
        latest.current.options.mutations!.pin!(id, nextPinned),
      );
    };
  if (options.mutations?.rename)
    listProps.onRename = (id, title) =>
      mutate("rename", id, "title", title, () =>
        latest.current.options.mutations!.rename!(id, title),
      );
  if (options.mutations?.archive)
    listProps.onDelete = (id) =>
      mutate("archive", id, "hidden", true, () =>
        latest.current.options.mutations!.archive!(id),
      );

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
