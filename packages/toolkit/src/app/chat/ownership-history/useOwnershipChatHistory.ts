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

interface Override {
  token: number;
  title?: string;
  pinned?: boolean;
  hidden?: boolean;
  settled: boolean;
  mineAtStart: readonly ChatThreadListRow[];
  sharedAtStart: readonly ChatThreadListRow[];
}

function matches(
  id: string,
  override: Override,
  mine: readonly ChatThreadListRow[],
  shared: readonly ChatThreadListRow[],
): boolean {
  if (mine === override.mineAtStart) return false;
  const row = mine.find((row) => row.id === id);
  if (override.hidden)
    return (
      shared !== override.sharedAtStart &&
      !row &&
      !shared.some((row) => row.id === id)
    );
  return (
    !!row &&
    (override.title === undefined || override.title === row.title) &&
    (override.pinned === undefined ||
      override.pinned === (row.pinnedAt != null))
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
  const listOptions = {
    apiUrl,
    scope,
    includeExternal,
    query,
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
    query?.trim(),
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
    return () => {
      generation.mounted = false;
    };
  }, [generation]);

  const refreshWithResults = useCallback(async () => {
    if (!enabled || !current()) return ["disabled", "disabled"] as const;
    const settled = [...overridesRef.current].filter(
      ([, override]) => override.settled,
    );
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
          const next = new Map(rows);
          for (const [id, override] of settled) {
            if (next.get(id)?.token === override.token) next.delete(id);
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
    const reconciled = [...overridesRef.current].filter(
      ([id, override]) =>
        override.settled && matches(id, override, mine.threads, shared.threads),
    );
    if (reconciled.length === 0) return;
    updateOverrides((rows) => {
      const next = new Map(rows);
      for (const [id, override] of reconciled) {
        if (next.get(id)?.token === override.token) next.delete(id);
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

  const mutate = async (
    kind: OwnershipChatHistoryMutationKind,
    id: string,
    patch: Pick<Override, "title" | "pinned" | "hidden">,
    persist: () => Promise<boolean>,
  ) => {
    if (!enabled || !current() || !findMine(id)) return false;
    const token = ++tokenRef.current;
    updateOverrides((rows) =>
      new Map(rows).set(id, {
        ...rows.get(id),
        ...patch,
        token,
        settled: false,
        mineAtStart: mine.threads,
        sharedAtStart: shared.threads,
      }),
    );
    let succeeded: boolean;
    try {
      succeeded = await persist();
    } catch (cause) {
      if (!current() || overridesRef.current.get(id)?.token !== token)
        return false;
      updateOverrides((rows) => {
        const next = new Map(rows);
        if (next.get(id)?.token === token) next.delete(id);
        return next;
      });
      latest.current.options.onMutationFailed?.(kind, id, cause);
      return false;
    }
    if (!current()) return false;
    if (!succeeded) {
      if (overridesRef.current.get(id)?.token !== token) return false;
      updateOverrides((rows) => {
        const next = new Map(rows);
        if (next.get(id)?.token === token) next.delete(id);
        return next;
      });
      latest.current.options.onMutationFailed?.(kind, id);
      return false;
    }
    const pending = overridesRef.current.get(id);
    if (pending?.token !== token) return true;
    if (
      matches(
        id,
        pending,
        latest.current.mine.threads,
        latest.current.shared.threads,
      ) &&
      !latest.current.mine.error &&
      !latest.current.shared.error
    ) {
      updateOverrides((rows) => {
        const next = new Map(rows);
        next.delete(id);
        return next;
      });
      return true;
    }
    updateOverrides((rows) =>
      new Map(rows).set(id, { ...pending, settled: true }),
    );
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
        overridesRef.current.get(id)?.pinned ??
        ("pinnedAt" in row && row.pinnedAt != null)
      );
      return mutate("pin", id, { pinned: nextPinned }, () =>
        latest.current.options.mutations!.pin!(id, nextPinned),
      );
    };
  if (options.mutations?.rename)
    listProps.onRename = (id, title) =>
      mutate("rename", id, { title }, () =>
        latest.current.options.mutations!.rename!(id, title),
      );
  if (options.mutations?.archive)
    listProps.onDelete = (id) =>
      mutate("archive", id, { hidden: true }, () =>
        latest.current.options.mutations!.archive!(id),
      );

  const mapItem = (
    row: ChatThreadListRow | OwnDraftRow,
    section: OwnershipChatHistorySection,
  ) => {
    const override = overrides.get(row.id);
    const mapped =
      "accessBasis" in row
        ? chatThreadToHistoryItem(row as ChatThreadListRow, {
            t,
            activeId,
            locale,
          })
        : ownDraftToHistoryItem(row, { t, activeId, locale });
    const item = {
      ...mapped,
      ...(override?.title === undefined
        ? {}
        : { title: override.title, titleText: override.title }),
      ...(override?.pinned === undefined ? {} : { pinned: override.pinned }),
    };
    const decorated = decorateItem?.(item, row, { section }) ?? item;
    return section === "shared"
      ? { ...decorated, pinned: false, hideActions: true }
      : decorated;
  };
  const visibleMine = mineRows.filter((row) => !overrides.get(row.id)?.hidden);
  const pinnedRows = pinned
    ? visibleMine.filter(
        (row) => overrides.get(row.id)?.pinned ?? row.pinnedAt != null,
      )
    : [];
  const pinnedIds = new Set(pinnedRows.map((row) => row.id));
  const mineItems = [
    ...drafts
      .filter((row) => !overrides.get(row.id)?.hidden)
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
