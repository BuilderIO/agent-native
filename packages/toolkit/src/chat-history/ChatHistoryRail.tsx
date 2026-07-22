import { IconDots, IconPlus } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { ActionButton, IconButton } from "../design-system/components.js";
import { DesignSystemErrorBoundary } from "../design-system/error-boundary.js";
import {
  ChatHistoryList,
  type ChatHistoryItem,
  type ChatHistoryListProps,
} from "./ChatHistoryList.js";
import {
  type ChatHistoryRailController,
  useChatHistoryRailController,
} from "./useChatHistoryRailController.js";

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
  /**
   * Product-level presentation slot for design systems that want to replace
   * the rail wholesale. State and actions still come from the same controller
   * as the default view.
   */
  renderRail?: (context: ChatHistoryRailRenderContext) => ReactNode;
}

export interface ChatHistoryRailRenderContext {
  controller: ChatHistoryRailController<ChatHistoryItem>;
  listProps: Omit<
    ChatHistoryListProps,
    "footer" | "items" | "sections" | "variant"
  >;
}

export type DefaultChatHistoryRailViewProps = ChatHistoryRailRenderContext;

export function DefaultChatHistoryRailView({
  controller,
  listProps,
}: ChatHistoryRailRenderContext) {
  const {
    canExpand,
    disclosureLabel,
    expanded,
    newChatLabel,
    onNewChat,
    toggleExpanded,
    visibleItems,
  } = controller;
  const { className, emptyLabel, ...rest } = listProps;

  const footer = (
    <div className="an-chat-history-rail__footer">
      <ActionButton
        type="button"
        className="an-chat-history-rail__new-chat"
        emphasis="ghost"
        size="compact"
        leadingIcon={
          <IconPlus size={13} strokeWidth={1.8} aria-hidden="true" />
        }
        onPress={onNewChat}
      >
        <span>{newChatLabel}</span>
      </ActionButton>
      {canExpand && (
        <IconButton
          type="button"
          className="an-chat-history-rail__disclosure"
          size="compact"
          icon={<IconDots size={14} strokeWidth={1.8} aria-hidden="true" />}
          onPress={toggleExpanded}
          aria-expanded={expanded}
          label={disclosureLabel}
          title={disclosureLabel}
        />
      )}
    </div>
  );

  return (
    <ChatHistoryList
      {...rest}
      items={visibleItems}
      footer={footer}
      emptyLabel={emptyLabel ?? null}
      variant="rail"
      className={["an-chat-history-rail", className].filter(Boolean).join(" ")}
    />
  );
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
  renderRail,
  className,
  emptyLabel,
  ...listProps
}: ChatHistoryRailProps) {
  const controller = useChatHistoryRailController({
    items,
    onNewChat,
    labels: railLabels,
    previewCount,
    expandedCount,
  });
  const context: ChatHistoryRailRenderContext = {
    controller,
    listProps: { ...listProps, className, emptyLabel },
  };
  const fallback = <DefaultChatHistoryRailView {...context} />;

  return renderRail ? (
    <DesignSystemErrorBoundary component="ChatHistoryRail" fallback={fallback}>
      <ChatHistoryRailCustomView renderRail={renderRail} context={context} />
    </DesignSystemErrorBoundary>
  ) : (
    fallback
  );
}

function ChatHistoryRailCustomView({
  renderRail,
  context,
}: {
  renderRail: NonNullable<ChatHistoryRailProps["renderRail"]>;
  context: ChatHistoryRailRenderContext;
}) {
  return renderRail(context);
}
