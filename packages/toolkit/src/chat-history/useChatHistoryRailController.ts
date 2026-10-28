import { useCallback, useEffect, useMemo, useState } from "react";

export interface ChatHistoryRailControllerLabels {
  newChat: string;
  showMore: string;
  showLess: string;
}

export interface UseChatHistoryRailControllerOptions<Item> {
  items: readonly Item[];
  onNewChat: () => void;
  labels: ChatHistoryRailControllerLabels;
  previewCount?: number;
  expandedCount?: number;
}

export interface ChatHistoryRailController<Item> {
  expanded: boolean;
  collapsedLimit: number;
  expandedLimit: number;
  visibleItems: Item[];
  canExpand: boolean;
  newChatLabel: string;
  disclosureLabel: string;
  onNewChat: () => void;
  toggleExpanded: () => void;
  resetExpanded: () => void;
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

export function useChatHistoryRailController<Item>({
  items,
  onNewChat,
  labels,
  previewCount,
  expandedCount,
}: UseChatHistoryRailControllerOptions<Item>): ChatHistoryRailController<Item> {
  const [expandedState, setExpandedState] = useState(false);
  const collapsedLimit = normalizeLimit(previewCount, 5);
  const expandedLimit = Math.max(
    collapsedLimit,
    normalizeLimit(expandedCount, 15),
  );
  const canExpand = items.length > collapsedLimit;
  const expanded = canExpand && expandedState;
  const visibleItems = useMemo(
    () => items.slice(0, expanded ? expandedLimit : collapsedLimit),
    [collapsedLimit, expanded, expandedLimit, items],
  );

  useEffect(() => {
    if (!canExpand) setExpandedState(false);
  }, [canExpand]);

  const toggleExpanded = useCallback(() => {
    if (canExpand) setExpandedState((current) => !current);
  }, [canExpand]);
  const resetExpanded = useCallback(() => setExpandedState(false), []);

  return {
    expanded,
    collapsedLimit,
    expandedLimit,
    visibleItems,
    canExpand,
    newChatLabel: labels.newChat,
    disclosureLabel: expanded ? labels.showLess : labels.showMore,
    onNewChat,
    toggleExpanded,
    resetExpanded,
  };
}

export interface ChatHistoryRailSectionControllerLabels {
  showAll: string;
  showLess: string;
  loadMore: string;
  loadingMore: string;
  retry: string;
}

export interface ChatHistoryRailSectionInput<Item> {
  id: string;
  items: readonly Item[];
  /** Rows shown before disclosure. Defaults to 5. */
  previewCount?: number;
  /**
   * The server has more rows than `items`. Disclosed sections then offer
   * `onLoadMore`; disclosed rows are never capped, so a loaded page is never
   * hidden. Ignored without `onLoadMore`.
   */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** Overrides the rail-level section labels for this section. */
  labels?: Partial<ChatHistoryRailSectionControllerLabels>;
}

export interface ChatHistoryRailSectionController<Item> {
  id: string;
  expanded: boolean;
  previewLimit: number;
  visibleItems: Item[];
  /** More rows exist, loaded or on the server, than the preview shows. */
  canExpand: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  /** Present only when the section is disclosed and the server has more. */
  loadMore: (() => void) | null;
  toggleExpanded: () => void;
  labels: ChatHistoryRailSectionControllerLabels;
}

export const DEFAULT_SECTION_PREVIEW_COUNT = 5;

/**
 * Independent preview/disclosure per section, keyed by section id. Disclosure
 * state is kept here rather than in each section so a section whose rows are
 * replaced by a refetch keeps its state.
 */
export function useChatHistoryRailSectionsController<Item>(
  sections: readonly ChatHistoryRailSectionInput<Item>[],
  sectionLabels: ChatHistoryRailSectionControllerLabels | undefined,
): ChatHistoryRailSectionController<Item>[] {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggle = useCallback((id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return sections.map((section) => {
    const previewLimit = normalizeLimit(
      section.previewCount,
      DEFAULT_SECTION_PREVIEW_COUNT,
    );
    const onLoadMore = section.onLoadMore;
    const hasMore = Boolean(section.hasMore && onLoadMore);
    const canExpand = section.items.length > previewLimit || hasMore;
    const expanded = canExpand && expandedIds.has(section.id);
    return {
      id: section.id,
      expanded,
      previewLimit,
      visibleItems: expanded
        ? [...section.items]
        : section.items.slice(0, previewLimit),
      canExpand,
      hasMore,
      loadingMore: Boolean(section.loadingMore),
      loadMore: expanded && hasMore && onLoadMore ? onLoadMore : null,
      toggleExpanded: () => {
        if (canExpand) toggle(section.id);
      },
      labels: {
        ...sectionLabels,
        ...section.labels,
      } as ChatHistoryRailSectionControllerLabels,
    };
  });
}
