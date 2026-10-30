import { useT } from "@agent-native/core/client/i18n";
import type { DragHandleMenuRequest } from "@agent-native/toolkit/editor";
import { IconCheck, IconSearch } from "@tabler/icons-react";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import {
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  blockActionLocks,
  blockCommentRange,
  blockTitleKey,
  canTurnInto,
  currentTurnIntoTarget,
  TURN_INTO_TARGETS,
  turnBlockInto,
  type BlockLock,
  type TurnIntoTarget,
} from "./block-actions";
import { startCommentOnRange, type BubbleToolbarProps } from "./BubbleToolbar";
import { blockColorChoices, ColorChoices, ColorSubmenu } from "./ColorSubmenu";
import { LOCAL_FILE_USER_EDIT_META } from "./extensions/LocalMdxComponentNode";
import { takesBlockColor } from "./extensions/NotionFidelity";
import { instantCloseMenuClass } from "./menu-classes";
import { MenuSwitchItem } from "./MenuSwitchItem";
import {
  getTableHeaders,
  setTableFitWidth,
  setTableHeaders,
  type TableAt,
} from "./table-commands";

interface BlockMenuHost {
  editor: Editor;
  open: (request: DragHandleMenuRequest) => () => void;
}

const hosts = new Set<BlockMenuHost>();

const TURN_INTO: Record<TurnIntoTarget, { labelKey: string }> = {
  text: { labelKey: "editor.slash.text" },
  heading1: { labelKey: "editor.heading1" },
  heading2: { labelKey: "editor.heading2" },
  heading3: { labelKey: "editor.heading3" },
  bulletedList: { labelKey: "editor.slash.bulletedList" },
  numberedList: {
    labelKey: "editor.slash.numberedList",
  },
  todoList: { labelKey: "editor.slash.todoList" },
  quote: { labelKey: "editor.slash.quote" },
  codeBlock: { labelKey: "editor.slash.codeBlock" },
};

const LOCK_REASON_KEYS: Record<BlockLock, string> = {
  source: "editor.blockMenu.lockedSource",
  suggesting: "editor.blockMenu.lockedSuggesting",
  page: "editor.blockMenu.lockedPage",
};

// ProseMirror's test for `Mod`, so each hint names the key its shortcut
// listens for.
const isApplePlatform = () =>
  typeof navigator !== "undefined" &&
  /Mac|iP(hone|[oa]d)/.test(navigator.platform);

const ENABLED_ITEMS = '[role^="menuitem"]:not([data-disabled])';

// A touch screen has no keys to press.
const hintClass = "pointer-coarse:hidden";

/**
 * The drag handle's `openMenu`: the editor's mounted BlockActionsMenu opens
 * in place of the handle's built-in menu.
 */
export function openBlockActionsMenu(request: DragHandleMenuRequest) {
  // Compared when the grip asks: until the editor mounts, `editor.view` is a
  // stand-in, not the view the grip will report.
  for (const host of hosts) {
    if (host.editor.view === request.view) {
      // The menu takes focus only after it renders, and losing focus
      // re-renders everything that watches the editor. Blurring now folds
      // that into the render that opens the menu.
      request.view.dom.blur();
      return host.open(request);
    }
  }
  return null;
}

export function BlockActionsMenu({
  editor,
  suggesting,
  onComment,
}: {
  editor: Editor;
  /** Suggested edits can't change a block's kind, colour, or table settings. */
  suggesting: boolean;
  onComment?: BubbleToolbarProps["onComment"];
}) {
  const t = useT();
  const [request, setRequest] = useState<DragHandleMenuRequest | null>(null);
  const [query, setQuery] = useState("");
  const [, setRevision] = useState(0);
  const escapedRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const reasonId = useId();

  // The menu takes focus when it opens unless focus is already inside it, so
  // the search keeps it. A phone's keyboard would cover the page, though.
  const searchInput = useCallback((input: HTMLInputElement | null) => {
    searchRef.current = input;
    const coarse =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    if (input && !coarse) {
      input.focus({ preventScroll: true });
    }
  }, []);
  const requestRef = useRef(request);

  useEffect(() => {
    requestRef.current = request;
  }, [request]);

  useEffect(() => {
    const host: BlockMenuHost = {
      editor,
      open: (next) => {
        setQuery("");
        setRequest(next);
        return () =>
          setRequest((current) => (current === next ? null : current));
      },
    };
    hosts.add(host);
    return () => {
      hosts.delete(host);
      // The page stopped being editable with the menu open: give the grip
      // back, or it stays held for a menu that's gone.
      requestRef.current?.onClose();
      setRequest(null);
    };
  }, [editor]);

  // The menu shows the block as it is, and goes when its block does. The
  // drag handle closes it when anything but the menu changes the block.
  useEffect(() => {
    if (!request) return;
    const redraw = () => {
      if (request.getBlock()) {
        setRevision((revision) => revision + 1);
      } else {
        setRequest(null);
        request.onClose();
      }
    };
    editor.on("transaction", redraw);
    return () => {
      editor.off("transaction", redraw);
    };
  }, [editor, request]);

  if (!request) return null;

  const block = request.getBlock();
  const node = block?.node ?? null;
  const table: TableAt | null =
    !suggesting && node?.type.name === "table" ? block : null;
  const headers = table ? getTableHeaders(table.node) : null;
  const turnTargets =
    !suggesting && node && canTurnInto(node) ? TURN_INTO_TARGETS : [];
  const currentTarget = node ? currentTurnIntoTarget(node) : null;
  const colorable = !suggesting && !!node && takesBlockColor(node.type.name);
  const commentRange =
    onComment && block ? blockCommentRange(block.node, block.pos) : null;
  const locks = block
    ? blockActionLocks(request.view.state, block.pos, block.node)
    : { duplicate: null, remove: null };
  const canDuplicate = !!block && !locks.duplicate;
  const canRemove = !!block && !locks.remove;

  const needle = query.trim().toLocaleLowerCase();
  const matches = (label: string) =>
    !needle || label.toLocaleLowerCase().includes(needle);
  const turnIntoLabel = t("editor.slash.turnInto");
  const foundTargets =
    needle && !matches(turnIntoLabel)
      ? turnTargets.filter((target) => matches(t(TURN_INTO[target].labelKey)))
      : turnTargets;

  const apple = isApplePlatform();
  const hint = (key: string, shift = false) =>
    apple
      ? `${shift ? "⇧" : ""}⌘${key}`
      : [
          t("editor.blockMenu.keyCtrl"),
          ...(shift ? [t("editor.blockMenu.keyShift")] : []),
          key,
        ].join("+");
  const ariaShortcut = (key: string, shift = false) =>
    [apple ? "Meta" : "Control", ...(shift ? ["Shift"] : []), key].join("+");

  const close = () => {
    setRequest(null);
    request.onClose();
  };

  // The menu holds focus, and Content saves an unfocused change only when it
  // is marked as the user's.
  const editTable = (edit: (tr: Transaction, table: TableAt) => void) => {
    const latest = request.getBlock();
    if (latest?.node.type.name !== "table") return;
    const tr = request.view.state.tr;
    edit(tr, latest);
    request.dispatch(tr.setMeta(LOCAL_FILE_USER_EDIT_META, true));
  };

  // A restyled block is ready to type in, from the end of its text.
  const restyleBlock = (edit: (tr: Transaction, pos: number) => boolean) => {
    const latest = request.getBlock();
    if (!latest) return;
    const tr = request.view.state.tr;
    if (!edit(tr, latest.pos)) return;
    const restyled = tr.doc.nodeAt(latest.pos);
    if (restyled) {
      tr.setSelection(
        TextSelection.near(
          tr.doc.resolve(latest.pos + restyled.nodeSize - 1),
          -1,
        ),
      );
    }
    request.dispatch(
      tr.setMeta(LOCAL_FILE_USER_EDIT_META, true).scrollIntoView(),
    );
    request.view.focus();
  };

  const turnInto = (target: TurnIntoTarget) =>
    restyleBlock((tr, pos) => turnBlockInto(tr, pos, target));

  const setColor = (color: string | null) =>
    restyleBlock((tr, pos) => {
      if (!takesBlockColor(tr.doc.nodeAt(pos)?.type.name ?? "")) return false;
      tr.setNodeAttribute(pos, "color", color);
      return true;
    });

  const comment = () => {
    const latest = request.getBlock();
    const range = latest && blockCommentRange(latest.node, latest.pos);
    if (onComment && range) startCommentOnRange(editor, onComment, range);
  };

  // The grip selected the whole block, which typing would replace, so Escape
  // puts the caret at the block's start instead.
  const returnToBlock = () => {
    const latest = request.getBlock();
    if (!latest) return;
    const { view } = request;
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.near(view.state.doc.resolve(latest.pos + 1)),
      ),
    );
    view.focus();
  };

  const enabledItems = () =>
    Array.from(
      contentRef.current?.querySelectorAll<HTMLElement>(ENABLED_ITEMS) ?? [],
    );

  // Each submenu needs this too: its Escape closes the whole menu without
  // reaching the root's handler.
  const markEscaped = () => {
    escapedRef.current = true;
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Keys an input method is composing with, or picking a candidate with,
    // are its alone: the menu's type-to-find would take focus from it.
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      event.stopPropagation();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const items = enabledItems();
      const item = event.key === "ArrowDown" ? items.shift() : items.pop();
      item?.focus();
    } else if (event.key === "Enter" && needle) {
      event.preventDefault();
      enabledItems()[0]?.click();
    } else if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      // The menu's type-to-find would move focus to a matching item.
      event.stopPropagation();
    }
  };

  // A submenu's keys reach this handler too, through React's tree.
  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const mod = apple ? event.metaKey : event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && !event.altKey && key === "d" && !event.shiftKey) {
      // Even a refused copy mustn't open the browser's bookmark dialog.
      event.preventDefault();
      if (canDuplicate) {
        request.duplicate();
        close();
      }
      return;
    }
    if (mod && !event.altKey && key === "m" && event.shiftKey) {
      event.preventDefault();
      if (commentRange) {
        comment();
        close();
      }
      return;
    }
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if (event.key === "Delete" && plain && !event.shiftKey && !query) {
      event.preventDefault();
      if (canRemove) {
        request.remove();
        close();
      }
      return;
    }

    const target = event.target as HTMLElement;
    const search = searchRef.current;
    if (
      !search ||
      target === search ||
      target.closest("[data-radix-menu-content]") !== event.currentTarget
    ) {
      return;
    }
    if (event.key === "ArrowUp" && target === enabledItems()[0]) {
      event.preventDefault();
      search.focus();
    } else if (event.key === "Backspace" && plain && query) {
      event.preventDefault();
      search.focus();
      setQuery((current) => current.slice(0, -1));
    } else if (event.key.length === 1 && event.key !== " " && plain) {
      // Typing anywhere in the menu filters it, as typing in its search does.
      event.preventDefault();
      search.focus();
      setQuery((current) => current + event.key);
    }
  };

  const turnIntoItem = (target: TurnIntoTarget) => {
    const { labelKey } = TURN_INTO[target];
    const checked = target === currentTarget;
    return (
      <DropdownMenuItem
        key={target}
        aria-checked={checked}
        className="gap-2"
        onSelect={() => turnInto(target)}
        role="menuitemradio"
      >
        {t(labelKey)}
        {checked ? <IconCheck className="ms-auto size-4 shrink-0" /> : null}
      </DropdownMenuItem>
    );
  };

  const tableSwitches =
    table && headers
      ? [
          {
            label: t("database.headerRow"),
            checked: headers.row,
            edit: (tr: Transaction, target: TableAt) =>
              setTableHeaders(tr, target, {
                row: !getTableHeaders(target.node).row,
              }),
          },
          {
            label: t("database.headerColumn"),
            checked: headers.column,
            edit: (tr: Transaction, target: TableAt) =>
              setTableHeaders(tr, target, {
                column: !getTableHeaders(target.node).column,
              }),
          },
          {
            label: t("database.fitToWidth"),
            checked: table.node.attrs.fitPageWidth === true,
            edit: (tr: Transaction, target: TableAt) =>
              setTableFitWidth(
                tr,
                target,
                target.node.attrs.fitPageWidth !== true,
              ),
          },
        ].filter((option) => matches(option.label))
      : [];

  const showColor = colorable && matches(t("editor.color.label"));
  const colorChoices = blockColorChoices(t);
  const foundColor =
    colorable &&
    !!needle &&
    !showColor &&
    [...colorChoices.text, ...colorChoices.background].some(({ label }) =>
      matches(label),
    );
  const showComment = !!commentRange && matches(t("editor.comment"));
  const showDuplicate = !!block && matches(t("editor.blockMenu.duplicate"));
  const showRemove = !!block && matches(t("editor.blockMenu.delete"));
  const showInsert = !!block && matches(t("editor.blockMenu.insertBelow"));
  const lockReasons = [
    ...new Set(
      [
        showDuplicate ? locks.duplicate : null,
        showRemove ? locks.remove : null,
      ].filter((lock): lock is BlockLock => !!lock),
    ),
  ];
  const lockReasonId = (lock: BlockLock | null) =>
    lock ? `${reasonId}-${lock}` : undefined;

  const sections: [string, ReactNode][] = [];
  if (tableSwitches.length > 0) {
    sections.push([
      "table",
      tableSwitches.map((option) => (
        <MenuSwitchItem
          key={option.label}
          checked={option.checked}
          onToggle={() => editTable(option.edit)}
        >
          {option.label}
        </MenuSwitchItem>
      )),
    ]);
  }
  if (needle && foundTargets.length > 0) {
    sections.push([
      "turn-into",
      <>
        <DropdownMenuLabel>{turnIntoLabel}</DropdownMenuLabel>
        {foundTargets.map(turnIntoItem)}
      </>,
    ]);
  }
  if (foundColor) {
    sections.push([
      "color",
      <ColorChoices
        value={node.attrs.color ?? null}
        onChange={setColor}
        shows={matches}
      />,
    ]);
  }
  if ((!needle && turnTargets.length > 0) || showColor) {
    sections.push([
      "style",
      <>
        {!needle && turnTargets.length > 0 ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              {turnIntoLabel}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              className={cn(
                "max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto",
                instantCloseMenuClass,
              )}
              collisionPadding={8}
              onEscapeKeyDown={markEscaped}
            >
              {turnTargets.map(turnIntoItem)}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        {showColor ? (
          <ColorSubmenu
            value={node.attrs.color ?? null}
            onChange={setColor}
            onEscapeKeyDown={markEscaped}
          />
        ) : null}
      </>,
    ]);
  }
  if (showDuplicate || showRemove || showInsert) {
    sections.push([
      "block",
      <>
        {showDuplicate ? (
          <DropdownMenuItem
            aria-describedby={lockReasonId(locks.duplicate)}
            aria-keyshortcuts={ariaShortcut("D")}
            className="gap-2"
            disabled={!canDuplicate}
            onSelect={request.duplicate}
          >
            {t("editor.blockMenu.duplicate")}
            <DropdownMenuShortcut className={hintClass}>
              {hint("D")}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        ) : null}
        {showRemove ? (
          <DropdownMenuItem
            aria-describedby={lockReasonId(locks.remove)}
            aria-keyshortcuts="Delete"
            className="gap-2 text-destructive focus:text-destructive"
            disabled={!canRemove}
            onSelect={request.remove}
          >
            {t("editor.blockMenu.delete")}
            <DropdownMenuShortcut className={hintClass}>
              {t("editor.blockMenu.keyDelete")}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        ) : null}
        {showInsert ? (
          <DropdownMenuItem className="gap-2" onSelect={request.insertBelow}>
            {t("editor.blockMenu.insertBelow")}
          </DropdownMenuItem>
        ) : null}
        {lockReasons.map((lock) => (
          <p
            key={lock}
            className="px-2 py-1 text-xs text-muted-foreground"
            id={lockReasonId(lock)}
          >
            {t(LOCK_REASON_KEYS[lock])}
          </p>
        ))}
      </>,
    ]);
  }
  if (showComment) {
    sections.push([
      "comment",
      <DropdownMenuItem
        aria-keyshortcuts={ariaShortcut("M", true)}
        className="gap-2"
        onSelect={comment}
      >
        {t("editor.comment")}
        <DropdownMenuShortcut className={hintClass}>
          {hint("M", true)}
        </DropdownMenuShortcut>
      </DropdownMenuItem>,
    ]);
  }

  const { anchorRect } = request;

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (open) return;
        close();
      }}
      open
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed"
          style={{
            height: anchorRect.height,
            left: anchorRect.left,
            top: anchorRect.top,
            width: anchorRect.width,
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={contentRef}
        align="start"
        aria-label={t("editor.blockMenu.label")}
        className={cn(
          "max-h-[var(--radix-dropdown-menu-content-available-height)] w-60 overflow-y-auto",
          instantCloseMenuClass,
        )}
        collisionPadding={8}
        // The actions focus the editor themselves, and a click elsewhere keeps
        // the focus it gave. This runs a tick after the menu goes, so focus
        // taken in between stays too.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const escaped = escapedRef.current;
          escapedRef.current = false;
          const focusTaken =
            !!document.activeElement &&
            document.activeElement !== document.body;
          if (escaped && !focusTaken) returnToBlock();
        }}
        onEscapeKeyDown={markEscaped}
        onKeyDown={handleMenuKeyDown}
        side="right"
        sideOffset={6}
      >
        <div className="border-b border-border/70 p-1">
          <div className="flex h-8 items-center gap-2 px-2">
            <IconSearch className="size-3.5 shrink-0 text-muted-foreground" />
            <Input
              ref={searchInput}
              aria-label={t("editor.blockMenu.search")}
              className="h-6 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t("editor.blockMenu.search")}
              value={query}
            />
          </div>
        </div>
        <DropdownMenuLabel>
          {t(node ? blockTitleKey(node) : "editor.blockMenu.block")}
        </DropdownMenuLabel>
        {sections.map(([key, section], index) => (
          <Fragment key={key}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            {section}
          </Fragment>
        ))}
        {sections.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {t("editor.blockMenu.noResults")}
          </p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
