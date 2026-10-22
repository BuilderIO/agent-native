import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import {
  IconDots,
  IconPencil,
  IconPinned,
  IconPinnedOff,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import React, { useMemo, useRef, useState } from "react";

import { Skeleton } from "../design-system/components.js";
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
  /** Already-translated owner name, shown on shared rows. */
  ownerLabel?: React.ReactNode;
  /** Already-translated access description, e.g. "Shared with you". */
  accessLabel?: React.ReactNode;
  accessBasis?: ChatHistoryAccessBasis;
  timestamp?: React.ReactNode;
  pinned?: boolean;
  disabled?: boolean;
  /**
   * Presentation only: drops the row menu and context menu while the row stays
   * selectable. The app decides which rows (e.g. not owned) get no actions.
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
  delete: string;
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
  delete: "Delete",
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
  renderRowActions,
  renderAdditionalRowActions,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search chats...",
  searchInputRef,
  loading = false,
  loadingLabel = "Searching...",
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
      delete: labels?.delete ?? DEFAULT_LABELS.delete,
    }),
    [
      labels?.delete,
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
          <div className="an-chat-history__state">{loadingLabel}</div>
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
                    <div
                      className="an-chat-history__skeletons"
                      aria-busy="true"
                      data-testid="chat-history-section-skeleton"
                    >
                      {["100%", "80%", "60%"].map((width) => (
                        <Skeleton
                          key={width}
                          shape="line"
                          width={width}
                          height={12}
                        />
                      ))}
                    </div>
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
                      renderRowActions={renderRowActions}
                      renderAdditionalRowActions={renderAdditionalRowActions}
                      labels={resolvedLabels}
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
  renderRowActions?: (item: ChatHistoryItem) => React.ReactNode;
  renderAdditionalRowActions?: (
    item: ChatHistoryItem,
    closeMenu: () => void,
  ) => React.ReactNode;
  labels: ChatHistoryListLabels;
};

const ChatHistoryRow = React.memo(function ChatHistoryRow({
  item,
  active,
  onSelect,
  onOpen,
  onTogglePin,
  onRename,
  renameMaxLength,
  onDelete,
  renderRowActions,
  renderAdditionalRowActions,
  labels,
}: ChatHistoryRowProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const hasMenu =
    !item.hideActions &&
    Boolean(
      onTogglePin ||
      onRename ||
      onDelete ||
      renderRowActions ||
      renderAdditionalRowActions,
    );

  function startRename() {
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

  return (
    <div
      className={cn(
        "an-chat-history-row",
        active && "an-chat-history-row--active",
        item.pinned && "an-chat-history-row--pinned",
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
          <div className="an-chat-history-row__topline">
            <span className="an-chat-history-row__title">{item.title}</span>
            {item.timestamp != null && (
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
          {(item.ownerLabel != null || item.accessLabel != null) && (
            <div
              className="an-chat-history-row__access"
              data-access-basis={item.accessBasis}
            >
              {item.ownerLabel != null && (
                <span className="an-chat-history-row__owner">
                  {item.ownerLabel}
                </span>
              )}
              {item.accessLabel != null && (
                <span className="an-chat-history-row__access-label">
                  {item.accessLabel}
                </span>
              )}
            </div>
          )}
        </button>
      )}

      {!isRenaming && hasMenu && (
        <DropdownMenuPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <div className="an-chat-history-row__menu">
            <DropdownMenuPrimitive.Trigger asChild>
              <button
                type="button"
                className={cn(
                  "an-chat-history-row__menu-trigger",
                  item.pinned && "an-chat-history-row__menu-trigger--pinned",
                )}
                aria-label={optionsLabel}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                {item.pinned ? (
                  <IconPinned size={13} strokeWidth={1.8} />
                ) : (
                  <IconDots size={14} strokeWidth={1.8} />
                )}
              </button>
            </DropdownMenuPrimitive.Trigger>
            <DropdownMenuPrimitive.Portal>
              <DropdownMenuPrimitive.Content
                className="an-chat-history-row__menu-content"
                align="end"
                collisionPadding={8}
                side="bottom"
                sideOffset={4}
              >
                {renderRowActions ? (
                  renderRowActions(item)
                ) : (
                  <>
                    {onRename && (
                      <button
                        type="button"
                        role="menuitem"
                        className="an-chat-history-row__menu-item"
                        onClick={startRename}
                      >
                        <IconPencil size={13} strokeWidth={1.8} />
                        <span>{labels.rename}</span>
                      </button>
                    )}
                    {onTogglePin && (
                      <button
                        type="button"
                        role="menuitem"
                        className="an-chat-history-row__menu-item"
                        onClick={() => {
                          setMenuOpen(false);
                          onTogglePin(item.id);
                        }}
                      >
                        {item.pinned ? (
                          <IconPinnedOff size={13} strokeWidth={1.8} />
                        ) : (
                          <IconPinned size={13} strokeWidth={1.8} />
                        )}
                        <span>{item.pinned ? labels.unpin : labels.pin}</span>
                      </button>
                    )}
                    {renderAdditionalRowActions?.(item, () =>
                      setMenuOpen(false),
                    )}
                    {onDelete && (
                      <button
                        type="button"
                        role="menuitem"
                        className="an-chat-history-row__menu-item an-chat-history-row__menu-item--danger"
                        onClick={() => {
                          setMenuOpen(false);
                          onDelete(item.id);
                        }}
                      >
                        <IconTrash size={13} strokeWidth={1.8} />
                        <span>{labels.delete}</span>
                      </button>
                    )}
                  </>
                )}
              </DropdownMenuPrimitive.Content>
            </DropdownMenuPrimitive.Portal>
          </div>
        </DropdownMenuPrimitive.Root>
      )}
    </div>
  );
});
