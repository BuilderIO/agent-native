import { IconDots, IconPinned, IconSearch } from "@tabler/icons-react";
import React, { useMemo, useRef, useState } from "react";

import { Skeleton, Tooltip } from "../design-system/components.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";
import { cn } from "../utils.js";

/** How the viewer got access to a chat; the app supplies the translated copy. */
export type ChatHistoryAccessBasis =
  | "owner"
  | "direct"
  | "organization"
  | "public";

export interface ChatHistoryItem {
  id: string;
  title: React.ReactNode;
  titleText?: string;
  subtitle?: React.ReactNode;
  detail?: React.ReactNode;
  /**
   * A shared row's owner mark, kept on one line beside the timestamp. Hovering
   * it shows `ownerLabel` and `accessLabel`, which also head the row menu.
   */
  ownerAvatar?: React.ReactNode;
  /** Already-translated owner name for a shared row. */
  ownerLabel?: React.ReactNode;
  /** Already-translated access description, e.g. "Shared with you". */
  accessLabel?: React.ReactNode;
  accessBasis?: ChatHistoryAccessBasis;
  timestamp?: React.ReactNode;
  pinned?: boolean;
  /** A reply finished while the viewer was away; shows a dot until opened. */
  unread?: boolean;
  disabled?: boolean;
  /**
   * The viewer can open the chat but not rename, pin or delete it, e.g. a chat
   * someone shared. The menu keeps the owner header and Copy link.
   */
  readOnly?: boolean;
  /**
   * Presentation only: drops the row menu and context menu while the row stays
   * selectable, e.g. for a draft that has not been saved yet.
   */
  hideActions?: boolean;
}

export interface ChatHistorySection {
  id: string;
  label?: React.ReactNode;
  items: ChatHistoryItem[];
  /** Section-level states; the section stays visible while any is set. */
  /** Initial load: skeleton rows until the first rows arrive. */
  loading?: boolean;
  /** Shown above any rows already loaded: a failed load never reads as empty. */
  error?: React.ReactNode;
  emptyLabel?: React.ReactNode;
  footer?: React.ReactNode;
}

export interface ChatHistoryListLabels {
  options: string | ((item: ChatHistoryItem) => string);
  renameInput: string | ((item: ChatHistoryItem) => string);
  rename: string;
  pin: string;
  unpin: string;
  copyLink: string;
  delete: string;
  /** Accessible name for the unread dot. */
  unread: string;
}

export interface ChatHistoryListProps {
  items?: ChatHistoryItem[];
  sections?: ChatHistorySection[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  onOpen?: (id: string) => void;
  onTogglePin?: (id: string) => void;
  onRename?: (id: string, nextTitle: string) => void;
  renameMaxLength?: number;
  onDelete?: (id: string) => void;
  /**
   * What `onDelete` does. Only "delete" destroys the chat and is styled as
   * destructive; "archive" is reversible.
   */
  deleteAction?: "delete" | "archive";
  /** Shown on every row, read-only ones included. */
  onCopyLink?: (id: string) => void;
  renderRowActions?: (item: ChatHistoryItem) => React.ReactNode;
  renderAdditionalRowActions?: (
    item: ChatHistoryItem,
    closeMenu: () => void,
  ) => React.ReactNode;

  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchInputRef?: React.Ref<HTMLInputElement>;

  loading?: boolean;
  /** Replaces the default skeleton rows while `loading`. */
  loadingLabel?: React.ReactNode;
  error?: React.ReactNode;
  emptyLabel?: React.ReactNode;
  emptySearchLabel?: React.ReactNode;

  labels?: Partial<ChatHistoryListLabels>;

  footer?: React.ReactNode;

  variant?: "popover" | "rail";
  className?: string;
  listClassName?: string;
}

const DEFAULT_LABELS: ChatHistoryListLabels = {
  options: "Chat options",
  renameInput: "Rename chat",
  rename: "Rename",
  pin: "Pin to top",
  unpin: "Unpin from top",
  copyLink: "Copy link",
  delete: "Delete",
  unread: "Unread",
};

export function ChatHistoryList({
  items,
  sections,
  activeId = null,
  onSelect,
  onOpen,
  onTogglePin,
  onRename,
  renameMaxLength,
  onDelete,
  deleteAction = "delete",
  onCopyLink,
  renderRowActions,
  renderAdditionalRowActions,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search chats...",
  searchInputRef,
  loading = false,
  loadingLabel,
  error,
  emptyLabel = "No chats yet",
  emptySearchLabel = "No matching chats",
  labels,
  footer,
  variant = "popover",
  className,
  listClassName,
}: ChatHistoryListProps) {
  const resolvedLabels = useMemo<ChatHistoryListLabels>(
    () => ({
      options: labels?.options ?? DEFAULT_LABELS.options,
      renameInput: labels?.renameInput ?? DEFAULT_LABELS.renameInput,
      rename: labels?.rename ?? DEFAULT_LABELS.rename,
      pin: labels?.pin ?? DEFAULT_LABELS.pin,
      unpin: labels?.unpin ?? DEFAULT_LABELS.unpin,
      copyLink: labels?.copyLink ?? DEFAULT_LABELS.copyLink,
      delete: labels?.delete ?? DEFAULT_LABELS.delete,
      unread: labels?.unread ?? DEFAULT_LABELS.unread,
    }),
    [
      labels?.copyLink,
      labels?.delete,
      labels?.unread,
      labels?.options,
      labels?.pin,
      labels?.rename,
      labels?.renameInput,
      labels?.unpin,
    ],
  );
  const resolvedSections: ChatHistorySection[] =
    sections ?? (items ? [{ id: "default", items }] : []);
  const totalCount = resolvedSections.reduce(
    (sum, section) => sum + section.items.length,
    0,
  );
  const hasSearchValue = Boolean(searchValue?.trim());
  const hasSectionState = resolvedSections.some((section) =>
    sectionHasState(section, hasSearchValue),
  );

  return (
    <div
      className={cn(
        "an-chat-history",
        variant === "rail" && "an-chat-history--rail",
        className,
      )}
      data-agent-native="chat-history-list"
    >
      {onSearchChange && (
        <div className="an-chat-history__search">
          <IconSearch size={13} className="an-chat-history__search-icon" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchValue ?? ""}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="an-chat-history__search-input"
          />
        </div>
      )}
      <div className={cn("an-chat-history__list", listClassName)}>
        {error ? (
          <div className="an-chat-history__state an-chat-history__state--error">
            {error}
          </div>
        ) : loading ? (
          loadingLabel != null ? (
            <div className="an-chat-history__state">{loadingLabel}</div>
          ) : (
            <ChatHistorySkeletonRows />
          )
        ) : totalCount === 0 && !hasSectionState ? (
          <div className="an-chat-history__state">
            {hasSearchValue ? emptySearchLabel : emptyLabel}
          </div>
        ) : (
          resolvedSections.map(
            (section) =>
              (section.items.length > 0 ||
                sectionHasState(section, hasSearchValue)) && (
                <div
                  key={section.id}
                  className="an-chat-history__section"
                  data-section-id={section.id}
                >
                  {section.label && (
                    <div className="an-chat-history__section-label">
                      {section.label}
                    </div>
                  )}
                  {section.error ? (
                    <div
                      className="an-chat-history__state an-chat-history__state--error"
                      role="alert"
                    >
                      {section.error}
                    </div>
                  ) : section.loading && section.items.length === 0 ? (
                    <ChatHistorySkeletonRows testId="chat-history-section-skeleton" />
                  ) : section.items.length === 0 &&
                    !hasSearchValue &&
                    section.emptyLabel ? (
                    <div className="an-chat-history__state">
                      {section.emptyLabel}
                    </div>
                  ) : null}
                  {section.items.map((item) => (
                    <ChatHistoryRow
                      key={item.id}
                      item={item}
                      active={item.id === activeId}
                      onSelect={onSelect}
                      onOpen={onOpen}
                      onTogglePin={onTogglePin}
                      onRename={onRename}
                      renameMaxLength={renameMaxLength}
                      onDelete={onDelete}
                      deleteAction={deleteAction}
                      onCopyLink={onCopyLink}
                      renderRowActions={renderRowActions}
                      renderAdditionalRowActions={renderAdditionalRowActions}
                      labels={resolvedLabels}
                      showTimestamp={variant !== "rail"}
                    />
                  ))}
                  {section.footer}
                </div>
              ),
          )
        )}
        {footer}
      </div>
    </div>
  );
}

const SKELETON_TITLE_WIDTHS = ["72%", "56%", "64%"];

function ChatHistorySkeletonRows({ testId }: { testId?: string }) {
  return (
    <div
      className="an-chat-history__skeletons"
      aria-busy="true"
      data-testid={testId}
    >
      {SKELETON_TITLE_WIDTHS.map((width) => (
        <div key={width} className="an-chat-history__skeleton-row">
          <Skeleton shape="line" width={width} height={12} />
        </div>
      ))}
    </div>
  );
}

/**
 * A row menu item with roving focus and typeahead. Use it for
 * `renderAdditionalRowActions` so app actions join the keyboard order.
 */
export const ChatHistoryMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuItem> & {
    tone?: "destructive" | "default";
  }
>(function ChatHistoryMenuItem({ className, tone = "default", ...props }, ref) {
  return (
    <DropdownMenuItem
      ref={ref}
      className={cn(
        "an-chat-history-row__menu-item",
        tone === "destructive" && "an-chat-history-row__menu-item--danger",
        className,
      )}
      {...props}
    />
  );
});

function sectionHasState(
  section: ChatHistorySection,
  searching: boolean,
): boolean {
  return Boolean(
    section.loading ||
    section.error ||
    (!searching && section.emptyLabel) ||
    section.footer,
  );
}

type ChatHistoryRowProps = {
  item: ChatHistoryItem;
  active: boolean;
  onSelect: (id: string) => void;
  onOpen?: (id: string) => void;
  onTogglePin?: (id: string) => void;
  onRename?: (id: string, nextTitle: string) => void;
  renameMaxLength?: number;
  onDelete?: (id: string) => void;
  deleteAction: "delete" | "archive";
  onCopyLink?: (id: string) => void;
  renderRowActions?: (item: ChatHistoryItem) => React.ReactNode;
  renderAdditionalRowActions?: (
    item: ChatHistoryItem,
    closeMenu: () => void,
  ) => React.ReactNode;
  labels: ChatHistoryListLabels;
  /** Rail rows stay title-only; the popover list keeps its timestamps. */
  showTimestamp: boolean;
};

function ChatHistoryOwnerSummary({ item }: { item: ChatHistoryItem }) {
  return (
    <span className="an-chat-history-owner">
      {item.ownerLabel != null && (
        <span className="an-chat-history-owner__name">{item.ownerLabel}</span>
      )}
      {item.accessLabel != null && (
        <span className="an-chat-history-owner__access">
          {item.accessLabel}
        </span>
      )}
    </span>
  );
}

const ChatHistoryRow = React.memo(function ChatHistoryRow({
  item,
  active,
  onSelect,
  onOpen,
  onTogglePin,
  onRename,
  renameMaxLength,
  onDelete,
  deleteAction,
  onCopyLink,
  renderRowActions,
  renderAdditionalRowActions,
  labels,
  showTimestamp,
}: ChatHistoryRowProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renamePendingRef = useRef(false);

  const editable = !item.readOnly;
  const hasOwner = item.ownerLabel != null || item.accessLabel != null;
  const hasMenu =
    !item.hideActions &&
    Boolean(
      (editable && (onTogglePin || onRename || onDelete)) ||
      onCopyLink ||
      renderRowActions ||
      renderAdditionalRowActions,
    );

  function startRename() {
    renamePendingRef.current = true;
    setDraftTitle(item.titleText ?? "");
    setIsRenaming(true);
    setMenuOpen(false);
    window.requestAnimationFrame(() => {
      renameInputRef.current?.select();
    });
  }

  function commitRename() {
    const trimmed = draftTitle.trim();
    setIsRenaming(false);
    if (trimmed && trimmed !== item.titleText) {
      onRename?.(item.id, trimmed);
    }
  }

  function handleRenameKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setIsRenaming(false);
    }
  }

  const optionsLabel =
    typeof labels.options === "function"
      ? labels.options(item)
      : labels.options;
  const renameInputLabel =
    typeof labels.renameInput === "function"
      ? labels.renameInput(item)
      : labels.renameInput;

  const hasPrecedingMenuItems =
    hasOwner ||
    (editable && (onRename || onTogglePin)) ||
    Boolean(onCopyLink || renderAdditionalRowActions);

  return (
    <div
      className={cn(
        "an-chat-history-row",
        active && "an-chat-history-row--active",
        item.pinned && "an-chat-history-row--pinned",
        item.unread && "an-chat-history-row--unread",
        hasMenu && "an-chat-history-row--has-menu",
        menuOpen && "an-chat-history-row--menu-open",
        isRenaming && "an-chat-history-row--renaming",
        item.disabled && "an-chat-history-row--disabled",
      )}
      onContextMenu={(event) => {
        if (!hasMenu) return;
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      {isRenaming ? (
        <div className="an-chat-history-row__rename">
          <input
            ref={renameInputRef}
            className="an-chat-history-row__rename-input"
            value={draftTitle}
            maxLength={renameMaxLength}
            onChange={(event) => setDraftTitle(event.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={commitRename}
            autoFocus
            aria-label={renameInputLabel}
          />
        </div>
      ) : (
        <button
          type="button"
          className="an-chat-history-row__button"
          onClick={() => !item.disabled && onSelect(item.id)}
          onDoubleClick={() => !item.disabled && onOpen?.(item.id)}
          disabled={item.disabled}
        >
          {item.unread && (
            <span
              className="an-chat-history-row__unread"
              role="img"
              aria-label={labels.unread}
            />
          )}
          <div className="an-chat-history-row__topline">
            <span className="an-chat-history-row__title">{item.title}</span>
            {item.ownerAvatar != null && (
              <Tooltip
                trigger={
                  <span
                    className="an-chat-history-row__owner-mark"
                    data-access-basis={item.accessBasis}
                  >
                    {item.ownerAvatar}
                  </span>
                }
                content={
                  hasOwner ? <ChatHistoryOwnerSummary item={item} /> : null
                }
                disabled={!hasOwner}
              />
            )}
            {showTimestamp && item.timestamp != null && (
              <span className="an-chat-history-row__timestamp">
                {item.timestamp}
              </span>
            )}
          </div>
          {item.subtitle != null && (
            <div className="an-chat-history-row__subtitle">{item.subtitle}</div>
          )}
          {item.detail != null && (
            <div className="an-chat-history-row__detail">{item.detail}</div>
          )}
        </button>
      )}

      {!isRenaming && hasMenu && (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <div className="an-chat-history-row__menu">
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "an-chat-history-row__menu-trigger",
                  item.pinned && "an-chat-history-row__menu-trigger--pinned",
                )}
                aria-label={optionsLabel}
              >
                {item.pinned ? (
                  <IconPinned size={16} strokeWidth={1.8} aria-hidden="true" />
                ) : (
                  <IconDots size={16} strokeWidth={1.8} aria-hidden="true" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="an-chat-history-row__menu-content"
              align="end"
              collisionPadding={8}
              side="bottom"
              sideOffset={4}
              onCloseAutoFocus={(event) => {
                // Rename swaps the trigger for an input; returning focus to
                // the trigger would blur the input and commit an empty edit.
                if (!renamePendingRef.current) return;
                renamePendingRef.current = false;
                event.preventDefault();
              }}
            >
              {hasOwner && (
                <div
                  className="an-chat-history-row__menu-owner"
                  data-access-basis={item.accessBasis}
                >
                  {item.ownerAvatar != null && (
                    <span aria-hidden="true">{item.ownerAvatar}</span>
                  )}
                  <ChatHistoryOwnerSummary item={item} />
                </div>
              )}
              {renderRowActions ? (
                renderRowActions(item)
              ) : (
                <>
                  {editable && onRename && (
                    <ChatHistoryMenuItem onSelect={startRename}>
                      {labels.rename}
                    </ChatHistoryMenuItem>
                  )}
                  {editable && onTogglePin && (
                    <ChatHistoryMenuItem onSelect={() => onTogglePin(item.id)}>
                      {item.pinned ? labels.unpin : labels.pin}
                    </ChatHistoryMenuItem>
                  )}
                  {onCopyLink && (
                    <ChatHistoryMenuItem onSelect={() => onCopyLink(item.id)}>
                      {labels.copyLink}
                    </ChatHistoryMenuItem>
                  )}
                  {renderAdditionalRowActions?.(item, () => setMenuOpen(false))}
                  {editable && onDelete && (
                    <>
                      {hasPrecedingMenuItems && (
                        <DropdownMenuSeparator className="an-chat-history-row__menu-separator" />
                      )}
                      <ChatHistoryMenuItem
                        tone={
                          deleteAction === "delete" ? "destructive" : "default"
                        }
                        onSelect={() => onDelete(item.id)}
                      >
                        {labels.delete}
                      </ChatHistoryMenuItem>
                    </>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </div>
        </DropdownMenu>
      )}
    </div>
  );
});
