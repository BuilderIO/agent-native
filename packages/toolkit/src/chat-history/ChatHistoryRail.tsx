import { IconDots, IconPlus } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import {
  ChatHistoryList,
  type ChatHistoryItem,
  type ChatHistoryListProps,
} from "./ChatHistoryList.js";

export interface ChatHistoryRailLabels {
  newChat: string;
  showMore: string;
  showLess: string;
}

export interface ChatHistoryRailProps extends Omit<
  ChatHistoryListProps,
  "footer" | "items" | "sections" | "variant"
> {
  items: ChatHistoryItem[];
  onNewChat: () => void;
  railLabels: ChatHistoryRailLabels;
  previewCount?: number;
  expandedCount?: number;
}

/**
 * Compact recent-chat rail for app sidebars. Hosts own thread persistence,
 * sorting, routing, and mutations; the rail only owns progressive disclosure.
 */
export function ChatHistoryRail({
  items,
  onNewChat,
  railLabels,
  previewCount = 5,
  expandedCount = 15,
  className,
  emptyLabel,
  ...listProps
}: ChatHistoryRailProps) {
  const [expanded, setExpanded] = useState(false);
  const collapsedLimit = Math.max(1, previewCount);
  const expandedLimit = Math.max(collapsedLimit, expandedCount);
  const canExpand = items.length > collapsedLimit;
  const visibleItems = useMemo(
    () => items.slice(0, expanded ? expandedLimit : collapsedLimit),
    [collapsedLimit, expanded, expandedLimit, items],
  );

  useEffect(() => {
    if (!canExpand) setExpanded(false);
  }, [canExpand]);

  const footer = (
    <div className="an-chat-history-rail__footer">
      <button
        type="button"
        className="an-chat-history-rail__new-chat"
        onClick={onNewChat}
      >
        <IconPlus size={13} strokeWidth={1.8} aria-hidden="true" />
        <span>{railLabels.newChat}</span>
      </button>
      {canExpand && (
        <button
          type="button"
          className="an-chat-history-rail__disclosure"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          aria-label={expanded ? railLabels.showLess : railLabels.showMore}
          title={expanded ? railLabels.showLess : railLabels.showMore}
        >
          <IconDots size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}
    </div>
  );

  return (
    <ChatHistoryList
      {...listProps}
      items={visibleItems}
      footer={footer}
      emptyLabel={emptyLabel ?? null}
      variant="rail"
      className={["an-chat-history-rail", className].filter(Boolean).join(" ")}
    />
  );
}
