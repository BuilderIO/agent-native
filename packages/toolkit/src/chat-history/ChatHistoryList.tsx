import {
  IconDots,
  IconPencil,
  IconPinned,
  IconPinnedOff,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import React, { useEffect, useRef, useState } from "react";

import { cn } from "../utils.js";

/** A single row in a chat history list. Purely data — no fetching, no
 * assistant-ui context. Formatting (relative time, "Active"/"Open" labels,
 * status spinners) is the caller's responsibility; hand in the already
 * rendered node via `timestamp`. */
export interface ChatHistoryItem {
  id: string;
  title: React.ReactNode;
  /** Plain-text form of `title`, used to seed the inline rename input.
   * Only needed when `onRename` is supplied. */
  titleText?: string;
  /** Secondary line — e.g. a message preview. */
  subtitle?: React.ReactNode;
  /** Tertiary line — e.g. a scope/folder label. */
  detail?: React.ReactNode;
  /** Pre-formatted trailing value: a relative time, "Active"/"Open", or a
   * status node (spinner, unread dot). This component does not format
   * dates or compute status itself. */
  timestamp?: React.ReactNode;
  pinned?: boolean;
  disabled?: boolean;
}

export interface ChatHistorySection {
  id: string;
  label?: React.ReactNode;
  items: ChatHistoryItem[];
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
  /** Flat item list. Ignored when `sections` is provided. */
  items?: ChatHistoryItem[];
  /** Grouped item list (e.g. "This deck" / "All chats", or pinned/recent). */
  sections?: ChatHistorySection[];
  /** Id of the currently active/selected item — highlighted in the list. */
  activeId?: string | null;
  onSelect: (id: string) => void;
  /** Fired on double-click / explicit "open" gesture, distinct from select. */
  onOpen?: (id: string) => void;
  /** Presence enables the pin/unpin row action. */
  onTogglePin?: (id: string) => void;
  /** Presence enables the inline "Rename" row action. */
  onRename?: (id: string, nextTitle: string) => void;
  /** Optional character limit for the inline rename input. */
  renameMaxLength?: number;
  /** Presence enables the "Delete" row action. */
  onDelete?: (id: string) => void;
  /** Escape hatch: fully custom row action menu content, replacing the
   * built-in rename/pin/delete items. Still gated by the trigger button,
   * which shows whenever this or any of the on* callbacks above is set. */
  renderRowActions?: (item: ChatHistoryItem) => React.ReactNode;
  /** App-specific actions inserted after pin and before delete. Call
   * `closeMenu` before starting the action. */
  renderAdditionalRowActions?: (
    item: ChatHistoryItem,
    closeMenu: () => void,
  ) => React.ReactNode;

  /** Controlled search input. Omit `onSearchChange` to hide the search box
   * entirely and let the host render its own (results are always supplied
   * by the caller via `items`/`sections` either way). */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  searchInputRef?: React.Ref<HTMLInputElement>;

  /** True while results are being fetched — shows `loadingLabel` instead of
   * the list. */
  loading?: boolean;
  loadingLabel?: React.ReactNode;
  /** Shown instead of the list when set (takes priority over `loading`). */
  error?: React.ReactNode;
  emptyLabel?: React.ReactNode;
  /** Shown instead of `emptyLabel` when `searchValue` is non-empty. */
  emptySearchLabel?: React.ReactNode;

  /** Optional localized labels for row actions and their accessible controls. */
  labels?: Partial<ChatHistoryListLabels>;

  /** Rendered after the list, inside the scroll container (e.g. a
   * "Load older chats" button). */
  footer?: React.ReactNode;

  /** "popover" (default) matches core's compact HistoryPopover list.
   * "rail" is a denser variant with a solid active background, closer to
   * a sidebar run rail. */
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

/**
 * Presentational chat history list shared by the Core `HistoryPopover`
 * and Agent-Native Code's run rail
 * (code-agents-ui). Styling is driven by stable `an-chat-history*` class
 * names (see `@agent-native/toolkit/chat-history.css`) rather than Tailwind utilities
 * so the same component renders correctly in a Tailwind host and in
 * code-agents-ui's plain-CSS host.
 *
 * This component owns no data: search filtering, pin/rename persistence,
 * and time formatting all stay with the caller. It only renders whatever
 * `items`/`sections` it is given, plus the optional search box and
 * loading/empty/error states.
 */
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
  const resolvedLabels: ChatHistoryListLabels = {
    options: labels?.options ?? DEFAULT_LABELS.options,
    renameInput: labels?.renameInput ?? DEFAULT_LABELS.renameInput,
    rename: labels?.rename ?? DEFAULT_LABELS.rename,
    pin: labels?.pin ?? DEFAULT_LABELS.pin,
    unpin: labels?.unpin ?? DEFAULT_LABELS.unpin,
    delete: labels?.delete ?? DEFAULT_LABELS.delete,
  };
  const resolvedSections: ChatHistorySection[] =
    sections ?? (items ? [{ id: "default", items }] : []);
  const totalCount = resolvedSections.reduce(
    (sum, section) => sum + section.items.length,
    0,
  );
  const hasSearchValue = Boolean(searchValue?.trim());

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
        ) : totalCount === 0 ? (
          <div className="an-chat-history__state">
            {hasSearchValue ? emptySearchLabel : emptyLabel}
          </div>
        ) : (
          resolvedSections.map(
            (section) =>
              section.items.length > 0 && (
                <div key={section.id} className="an-chat-history__section">
                  {section.label && (
                    <div className="an-chat-history__section-label">
                      {section.label}
                    </div>
                  )}
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
                </div>
              ),
          )
        )}
        {footer}
      </div>
    </div>
  );
}

function ChatHistoryRow({
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
}: {
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
}) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const hasMenu = Boolean(
    onTogglePin ||
    onRename ||
    onDelete ||
    renderRowActions ||
    renderAdditionalRowActions,
  );

  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

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
        isRenaming && "an-chat-history-row--renaming",
        item.disabled && "an-chat-history-row--disabled",
      )}
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
        </button>
      )}

      {!isRenaming && hasMenu && (
        <div className="an-chat-history-row__menu" ref={menuRef}>
          <button
            type="button"
            className={cn(
              "an-chat-history-row__menu-trigger",
              item.pinned && "an-chat-history-row__menu-trigger--pinned",
            )}
            aria-label={optionsLabel}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {item.pinned ? (
              <IconPinned size={13} strokeWidth={1.8} />
            ) : (
              <IconDots size={14} strokeWidth={1.8} />
            )}
          </button>
          {menuOpen && (
            <div className="an-chat-history-row__menu-content" role="menu">
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
                  {renderAdditionalRowActions?.(item, () => setMenuOpen(false))}
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}
