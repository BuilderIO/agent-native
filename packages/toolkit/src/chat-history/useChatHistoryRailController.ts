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
  const canExpand =
    expandedLimit > collapsedLimit && items.length > collapsedLimit;
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
