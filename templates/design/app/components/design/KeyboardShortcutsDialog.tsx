import { useT } from "@agent-native/core/client/i18n";
import { IconSearch, IconX } from "@tabler/icons-react";
import { type RefObject, useCallback, useMemo, useRef, useState } from "react";

import { createCoreCommands } from "@/components/design/code-workbench/commands";
import {
  buildShortcutSections,
  type ShortcutRow,
  type ShortcutSectionCategory,
} from "@/components/design/keyboard-shortcut-sections";
import { formatShortcutKeycaps } from "@/components/design/keyboard-shortcuts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  isApplePlatform,
  isShowKeyboardShortcutsHotkey,
} from "@/hooks/useDesignHotkeys";
import { cn } from "@/lib/utils";

const DIALOG_ATTRIBUTE = "data-keyboard-shortcuts-dialog";

/** True when a keyboard event originates inside the open shortcuts dialog. */
export function isKeyboardShortcutsDialogTarget(target: EventTarget | null) {
  return (
    typeof Element !== "undefined" &&
    target instanceof Element &&
    target.closest(`[${DIALOG_ATTRIBUTE}]`) !== null
  );
}

/**
 * Editor hotkeys must not fire from inside the modal (a focused category
 * button would otherwise still switch tools on `r`). Only the chord that
 * toggles the dialog itself passes through.
 */
export function isEditorHotkeyBlockedByShortcutsDialog(event: KeyboardEvent) {
  return (
    isKeyboardShortcutsDialogTarget(event.target) &&
    !isShowKeyboardShortcutsHotkey(event)
  );
}

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Shortcut ids to leave out because their tool is not available. */
  unavailableShortcutIds?: readonly string[];
}

const ACCESSIBLE_KEY_NAME_BY_TOKEN: Record<string, string> = {
  alt: "alt",
  arrowdown: "arrowDown",
  arrowleft: "arrowLeft",
  arrowright: "arrowRight",
  arrowup: "arrowUp",
  backspace: "backspace",
  ctrl: "control",
  delete: "delete",
  enter: "enter",
  shift: "shift",
  tab: "tab",
  "?": "questionMark",
  "\\": "backslash",
  "=": "equals",
  "-": "minus",
  "[": "leftBracket",
  "]": "rightBracket",
};

// Programmatic scrolls from a category click fire scroll events too; the
// scroll-spy ignores them so the clicked category stays highlighted even when
// the list cannot scroll far enough to put it at the top.
const SCROLL_SPY_LOCK_MS = 400;

function KeycapGroup({
  binding,
  applePlatform,
}: {
  binding: string;
  applePlatform: boolean;
}) {
  return (
    <span
      data-keycap-group={binding}
      aria-hidden="true"
      className="inline-flex items-center gap-1 whitespace-nowrap"
    >
      {formatShortcutKeycaps(binding, applePlatform).map((keycap, index) => (
        <kbd
          key={`${keycap}-${index}`}
          aria-hidden="true"
          className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-muted px-1.5 font-sans text-[11px] font-medium leading-none text-muted-foreground"
        >
          {keycap}
        </kbd>
      ))}
    </span>
  );
}

function ShortcutBindings({ bindings }: { bindings: readonly string[] }) {
  const t = useT();
  const applePlatform = isApplePlatform();
  const orLabel = t("designEditor.keyboardShortcuts.keys.or");
  const accessibleBindings = bindings.map((binding) =>
    binding
      .split("+")
      .map((rawToken) => {
        const token = rawToken.toLowerCase();
        if (token === "$mod") {
          return t(
            `designEditor.keyboardShortcuts.keys.${applePlatform ? "command" : "control"}`,
          );
        }
        if (token === "alt" && applePlatform) {
          return t("designEditor.keyboardShortcuts.keys.option");
        }
        const keyName = ACCESSIBLE_KEY_NAME_BY_TOKEN[token];
        if (keyName) {
          return t(`designEditor.keyboardShortcuts.keys.${keyName}`);
        }
        return rawToken.length === 1 ? rawToken.toLocaleUpperCase() : rawToken;
      })
      .join(" "),
  );

  return (
    <span
      data-shortcut-bindings
      role="group"
      aria-label={accessibleBindings.join(` ${orLabel} `)}
      className="flex shrink-0 items-center gap-1.5"
    >
      {bindings.map((binding, index) => (
        <span key={binding} className="flex items-center gap-1.5">
          {index > 0 ? (
            <span aria-hidden="true" className="text-xs text-muted-foreground">
              {orLabel}
            </span>
          ) : null}
          <KeycapGroup binding={binding} applePlatform={applePlatform} />
        </span>
      ))}
    </span>
  );
}

function ShortcutRowView({ row }: { row: ShortcutRow }) {
  const t = useT();
  return (
    <li
      data-shortcut-id={row.source === "design" ? row.id : undefined}
      data-code-shortcut-id={row.source === "code" ? row.id : undefined}
      className="flex min-h-8 items-center justify-between gap-4 py-1"
    >
      <span className="min-w-0 truncate text-sm text-foreground">
        {row.label}
        {row.badge ? (
          <span className="ms-2 rounded bg-muted px-1 py-0.5 align-middle text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("designEditor.keyboardShortcuts.screenContext")}
          </span>
        ) : null}
      </span>
      <ShortcutBindings bindings={row.bindings} />
    </li>
  );
}

function KeyboardShortcutsBody({
  searchRef,
  unavailableShortcutIds,
}: {
  searchRef: RefObject<HTMLInputElement | null>;
  unavailableShortcutIds?: readonly string[];
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] =
    useState<ShortcutSectionCategory>("essential");
  const listRef = useRef<HTMLDivElement | null>(null);
  const spyLockedUntilRef = useRef(0);
  const codeCommands = useMemo(() => createCoreCommands(), []);
  const applePlatform = isApplePlatform();

  const sections = useMemo(
    () =>
      buildShortcutSections({
        query,
        applePlatform,
        categoryLabel: (category) =>
          t(`designEditor.keyboardShortcuts.categories.${category}`),
        rowLabel: (labelKey) => t(labelKey),
        codeCommands,
        unavailableIds: unavailableShortcutIds,
      }),
    [applePlatform, codeCommands, query, t, unavailableShortcutIds],
  );

  const sectionTop = (category: string) => {
    const list = listRef.current;
    const section = list?.querySelector<HTMLElement>(
      `[data-shortcut-section="${category}"]`,
    );
    if (!list || !section) return null;
    return (
      section.getBoundingClientRect().top -
      list.getBoundingClientRect().top +
      list.scrollTop
    );
  };

  const handleCategoryClick = (category: ShortcutSectionCategory) => {
    const list = listRef.current;
    const top = sectionTop(category);
    setActiveCategory(category);
    if (!list || top === null) return;
    spyLockedUntilRef.current = Date.now() + SCROLL_SPY_LOCK_MS;
    list.scrollTo({ top });
  };

  const handleScroll = useCallback(() => {
    if (Date.now() < spyLockedUntilRef.current) return;
    const list = listRef.current;
    if (!list) return;
    let current: ShortcutSectionCategory | null = null;
    for (const section of sections) {
      const top = sectionTop(section.category);
      if (top !== null && top <= list.scrollTop + 8) current = section.category;
    }
    if (current) setActiveCategory(current);
  }, [sections]);

  const highlighted = sections.some(
    (section) => section.category === activeCategory,
  )
    ? activeCategory
    : sections[0]?.category;

  return (
    <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
      <div className="flex shrink-0 flex-col gap-2 border-b border-border p-2 sm:w-48 sm:border-b-0 sm:border-e">
        <div className="relative">
          <IconSearch
            aria-hidden="true"
            className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={searchRef}
            data-shortcuts-search
            type="search"
            size="sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("designEditor.keyboardShortcuts.search")}
            aria-label={t("designEditor.keyboardShortcuts.searchLabel")}
            autoComplete="off"
            spellCheck={false}
            className="ps-8 text-sm md:text-sm [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
        <nav
          data-shortcuts-categories
          aria-label={t("designEditor.keyboardShortcuts.categoriesLabel")}
          className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-y-auto sm:overflow-x-hidden"
        >
          {sections.map((section) => (
            <button
              key={section.category}
              type="button"
              data-shortcuts-category={section.category}
              aria-current={
                highlighted === section.category ? "true" : undefined
              }
              onClick={() => handleCategoryClick(section.category)}
              className={cn(
                "shrink-0 rounded-md px-2.5 py-1.5 text-start text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                highlighted === section.category &&
                  "bg-accent font-medium text-foreground",
              )}
            >
              {section.label}
            </button>
          ))}
        </nav>
      </div>

      <div
        ref={listRef}
        data-shortcuts-list
        onScroll={handleScroll}
        className="relative min-h-0 flex-1 overflow-y-auto px-4 pb-24"
      >
        {sections.length === 0 ? (
          <p
            data-shortcuts-empty
            role="status"
            className="py-8 text-center text-sm text-muted-foreground"
          >
            {t("designEditor.keyboardShortcuts.empty", { query: query.trim() })}
          </p>
        ) : (
          sections.map((section) => (
            <section
              key={section.category}
              data-shortcut-section={section.category}
              aria-labelledby={`shortcuts-heading-${section.category}`}
            >
              <h3
                id={`shortcuts-heading-${section.category}`}
                className="sticky top-0 z-10 bg-background pb-1 pt-4 text-xs font-semibold text-muted-foreground"
              >
                {section.label}
              </h3>
              <ul role="list">
                {section.rows.map((row) => (
                  <ShortcutRowView key={`${row.source}-${row.id}`} row={row} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

export function KeyboardShortcutsDialog({
  open,
  onClose,
  unavailableShortcutIds,
}: KeyboardShortcutsDialogProps) {
  const t = useT();
  const searchRef = useRef<HTMLInputElement | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        {...{ [DIALOG_ATTRIBUTE]: "" }}
        hideClose
        aria-describedby={undefined}
        className="flex h-[min(640px,calc(100dvh-32px))] w-[calc(100vw-24px)] max-w-[760px] flex-col gap-0 overflow-hidden p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchRef.current?.focus({ preventScroll: true });
        }}
        // The editor restores focus itself (handleCloseKeyboardShortcuts), so
        // Radix's own return would race it.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border ps-4 pe-2">
          <DialogTitle className="text-sm font-semibold leading-none">
            {t("designEditor.keyboardShortcuts.title")}
          </DialogTitle>
          <DialogClose asChild>
            <Button
              data-keyboard-shortcuts-close
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("designEditor.keyboardShortcuts.close")}
            >
              <IconX className="size-4" />
            </Button>
          </DialogClose>
        </div>
        <KeyboardShortcutsBody
          searchRef={searchRef}
          unavailableShortcutIds={unavailableShortcutIds}
        />
      </DialogContent>
    </Dialog>
  );
}
