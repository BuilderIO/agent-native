import { IconChevronDown, IconChevronUp, IconPlus } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { ActionButton, IconButton } from "../design-system/components.js";
import { DesignSystemErrorBoundary } from "../design-system/error-boundary.js";
import {
  ChatHistoryList,
  type ChatHistoryItem,
  type ChatHistoryListProps,
  type ChatHistorySection,
} from "./ChatHistoryList.js";
import {
  type ChatHistoryRailController,
  type ChatHistoryRailSectionController,
  type ChatHistoryRailSectionControllerLabels,
  type ChatHistoryRailSectionInput,
  useChatHistoryRailController,
  useChatHistoryRailSectionsController,
} from "./useChatHistoryRailController.js";

export interface ChatHistoryRailLabels {
  newChat: string;
  showMore: string;
  showLess: string;
  /**
   * Translated disclosure, load-more, and retry copy for every section.
   * Required whenever the rail is given `sections`; there are no defaults.
   */
  sections?: ChatHistoryRailSectionControllerLabels;
}

export interface ChatHistoryRailSection extends ChatHistoryRailSectionInput<ChatHistoryItem> {
  label?: ReactNode;
  /** Initial load: renders skeleton rows until the first rows arrive. */
  loading?: boolean;
  /** A failed load, shown above any rows already loaded. */
  error?: ReactNode;
  onRetry?: () => void;
  emptyLabel?: ReactNode;
}

type ChatHistoryRailListProps = Omit<
  ChatHistoryListProps,
  "footer" | "items" | "sections" | "variant"
>;

interface ChatHistoryRailBaseProps extends ChatHistoryRailListProps {
  onNewChat: () => void;
  previewCount?: number;
  expandedCount?: number;
  renderRail?: (context: ChatHistoryRailRenderContext) => ReactNode;
}

interface ChatHistoryRailFlatProps {
  /** One flat list with a single disclosure. */
  items?: ChatHistoryItem[];
  sections?: undefined;
  showNewChat?: undefined;
  railLabels: ChatHistoryRailLabels;
}

interface ChatHistoryRailSectionedProps {
  /**
   * Independent sections, each with its own preview, disclosure, paging, and
   * loading/error/empty states. The app owns which rows each section holds.
   */
  sections: ChatHistoryRailSection[];
  items?: undefined;
  /**
   * Set false when the surrounding chrome already owns New chat. `onNewChat`
   * stays required and callable; only the rail's own button is dropped.
   */
  showNewChat?: boolean;
  railLabels: ChatHistoryRailLabels & {
    sections: ChatHistoryRailSectionControllerLabels;
  };
}

export type ChatHistoryRailProps = ChatHistoryRailBaseProps &
  (ChatHistoryRailFlatProps | ChatHistoryRailSectionedProps);

export interface ChatHistoryRailSectionRenderState {
  section: ChatHistoryRailSection;
  controller: ChatHistoryRailSectionController<ChatHistoryItem>;
}

export interface ChatHistoryRailRenderContext {
  controller: ChatHistoryRailController<ChatHistoryItem>;
  /** Empty unless the rail was given `sections`. */
  sections: ChatHistoryRailSectionRenderState[];
  listProps: ChatHistoryRailListProps;
  /** Sectioned rails only; defaults to true. */
  showNewChat?: boolean;
}

/** `sections` stays optional so views written for the flat rail keep working. */
export type DefaultChatHistoryRailViewProps = Omit<
  ChatHistoryRailRenderContext,
  "sections"
> &
  Partial<Pick<ChatHistoryRailRenderContext, "sections">>;

function SectionFooter({
  section,
  controller,
}: ChatHistoryRailSectionRenderState) {
  const { labels, loadMore } = controller;
  if (!controller.canExpand) return null;
  return (
    <div className="an-chat-history-rail__section-footer">
      <ActionButton
        type="button"
        className="an-chat-history-rail__section-toggle"
        emphasis="ghost"
        size="compact"
        trailingIcon={
          controller.expanded ? (
            <IconChevronUp size={13} strokeWidth={1.8} aria-hidden="true" />
          ) : (
            <IconChevronDown size={13} strokeWidth={1.8} aria-hidden="true" />
          )
        }
        onPress={controller.toggleExpanded}
        aria-expanded={controller.expanded}
        data-section-id={section.id}
      >
        <span>{controller.expanded ? labels.showLess : labels.showAll}</span>
      </ActionButton>
      {loadMore && (
        <ActionButton
          type="button"
          className="an-chat-history-rail__load-more"
          emphasis="ghost"
          size="compact"
          pending={controller.loadingMore}
          disabled={controller.loadingMore}
          onPress={loadMore}
        >
          <span>
            {controller.loadingMore ? labels.loadingMore : labels.loadMore}
          </span>
        </ActionButton>
      )}
    </div>
  );
}

function toListSection(
  state: ChatHistoryRailSectionRenderState,
): ChatHistorySection {
  const { section, controller } = state;
  return {
    id: section.id,
    label: section.label,
    items: controller.visibleItems,
    loading: section.loading,
    error: section.error ? (
      <>
        <span>{section.error}</span>
        {section.onRetry && (
          <ActionButton
            type="button"
            className="an-chat-history-rail__retry"
            emphasis="ghost"
            size="compact"
            onPress={section.onRetry}
          >
            <span>{controller.labels.retry}</span>
          </ActionButton>
        )}
      </>
    ) : undefined,
    emptyLabel: section.emptyLabel,
    footer: <SectionFooter {...state} />,
  };
}

export function DefaultChatHistoryRailView({
  controller,
  sections = [],
  listProps,
  showNewChat = true,
}: DefaultChatHistoryRailViewProps) {
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

  const footer = (showNewChat || canExpand) && (
    <div className="an-chat-history-rail__footer">
      {showNewChat && (
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
      )}
      {canExpand && (
        <IconButton
          type="button"
          className="an-chat-history-rail__disclosure"
          size="compact"
          icon={
            expanded ? (
              <IconChevronUp size={14} strokeWidth={1.8} aria-hidden="true" />
            ) : (
              <IconChevronDown size={14} strokeWidth={1.8} aria-hidden="true" />
            )
          }
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
      {...(sections.length > 0
        ? { sections: sections.map(toListSection) }
        : { items: visibleItems })}
      footer={footer || undefined}
      emptyLabel={emptyLabel ?? null}
      variant="rail"
      className={["an-chat-history-rail", className].filter(Boolean).join(" ")}
    />
  );
}

export function ChatHistoryRail({
  items,
  sections: sectionInputs,
  showNewChat,
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
    items: sectionInputs ? [] : (items ?? []),
    onNewChat,
    labels: railLabels,
    previewCount,
    expandedCount,
  });
  const sectionControllers = useChatHistoryRailSectionsController(
    sectionInputs ?? [],
    railLabels.sections,
  );
  const context: ChatHistoryRailRenderContext = {
    controller,
    sections: (sectionInputs ?? []).map((section, index) => ({
      section,
      controller: sectionControllers[index],
    })),
    listProps: { ...listProps, className, emptyLabel },
    showNewChat,
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
