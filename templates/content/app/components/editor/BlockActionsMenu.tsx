import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import type { DragHandleMenuRequest } from "@agent-native/toolkit/editor";
import { docToNfm, longestRun } from "@shared/nfm";
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconSearch,
} from "@tabler/icons-react";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import {
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

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
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { isApplePlatform } from "@/lib/platform";
import { cn } from "@/lib/utils";

import {
  blockActionLocks,
  blockCommentRange,
  canTurnInto,
  currentTurnIntoTarget,
  TURN_INTO_TARGETS,
  turnBlockInto,
  type BlockLock,
  type TurnIntoTarget,
} from "./block-actions";
import {
  BLOCK_MENU_GAP,
  BLOCK_MENU_HEIGHT,
  BLOCK_MENU_PADDING,
  pageLeftOf,
  placeBlockMenu,
  type BlockMenuPlacement,
  type Box,
} from "./block-menu-placement";
import {
  blockMenuEntry,
  type BlockAt,
  type BlockMenuSwitch,
} from "./block-menu-registry";
import { startCommentOnRange, type BubbleToolbarProps } from "./BubbleToolbar";
import {
  blockColorChoices,
  chosenColor,
  ColorChoices,
  ColorSubmenu,
  ColorSwatch,
} from "./ColorSubmenu";
import { LOCAL_FILE_USER_EDIT_META } from "./extensions/LocalMdxComponentNode";
import { takesBlockColor } from "./extensions/NotionFidelity";
import { instantCloseMenuClass, menuSearchInputClass } from "./menu-classes";
import { MenuSwitchItem } from "./MenuSwitchItem";
import { useMoveBlock } from "./MoveBlockDialog";

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
  toggle: { labelKey: "editor.slash.toggle" },
  toggleHeading1: { labelKey: "editor.slash.toggleHeading1" },
  toggleHeading2: { labelKey: "editor.slash.toggleHeading2" },
  toggleHeading3: { labelKey: "editor.slash.toggleHeading3" },
  quote: { labelKey: "editor.slash.quote" },
  codeBlock: { labelKey: "editor.slash.codeBlock" },
};

const LOCK_REASON_KEYS: Record<BlockLock, string> = {
  source: "editor.blockMenu.lockedSource",
  suggesting: "editor.blockMenu.lockedSuggesting",
  page: "editor.blockMenu.lockedPage",
  collection: "editor.blockMenu.lockedCollection",
  uploadedClip: "editor.blockMenu.lockedUploadedClip",
};

const SHEET_ITEM = "data-block-sheet-item";
const OPENS_VIEW = "data-opens-view";
const ENABLED_ITEMS = `[role^="menuitem"]:not([data-disabled]), [${SHEET_ITEM}]:not(:disabled)`;

// A touch screen has no keys to press.
const hintClass = "pointer-coarse:hidden";

// A row a finger can hit: 44 px, as phones' own sheets have.
const sheetRowClass =
  "flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-start text-sm outline-none focus-visible:bg-accent active:bg-accent disabled:pointer-events-none disabled:opacity-50";
const sheetLabelClass =
  "px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground";

// Enough of a long block for the agent to see what it is; it can read the
// rest from the page, and the composer refuses an oversized attachment.
const ASK_AGENT_MAX_CHARS = 16_000;

/** A phone gets the menu as a sheet from the bottom of the screen. */
function opensAsSheet() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse) and (max-width: 767px)").matches
  );
}

function isInlineCollection(node: BlockAt["node"]) {
  return (
    node.type.name === "registryBlock" &&
    node.attrs.blockType === "inline-database"
  );
}

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

/** One of the actions every block's menu lists. */
interface BlockMenuAction {
  id: string;
  label: string;
  onSelect: () => void;
  /** Why the block refuses this action, which the menu shows beneath it. */
  lock?: BlockLock | null;
  destructive?: boolean;
  /** The shortcut as the menu shows it, and as `aria-keyshortcuts` names it. */
  shortcut?: { hint: string; aria: string };
}

/**
 * The menu's groups, in order. The dropdown and the phone's sheet both draw
 * them, so the two always offer the same things.
 */
type BlockMenuSection =
  | { key: "switches"; switches: BlockMenuSwitch[] }
  | { key: "found-turn-into"; targets: readonly TurnIntoTarget[] }
  | { key: "found-color" }
  | { key: "style"; turnInto: boolean; color: boolean }
  | {
      key: "convert" | "insert" | "block" | "assist";
      actions: BlockMenuAction[];
    };

type SheetView = "menu" | "turn-into" | "color";

interface BlockMenuLayout {
  placement: BlockMenuPlacement;
  wrapper: HTMLElement | null;
  tint: Box;
}

const boxStyle = (box: Box) => ({
  height: box.height,
  left: box.left,
  top: box.top,
  width: box.width,
});

function measureBlockMenu(
  request: DragHandleMenuRequest,
  menuHeight: number,
): BlockMenuLayout {
  const block = request.getBlock();
  const dom = block ? request.view.nodeDOM(block.pos) : null;
  const blockRect =
    dom instanceof HTMLElement
      ? dom.getBoundingClientRect()
      : request.anchorRect;
  const wrapper = request.view.dom.closest<HTMLElement>(
    ".visual-editor-wrapper",
  );
  const origin = wrapper?.getBoundingClientRect() ?? { top: 0, left: 0 };
  return {
    placement: placeBlockMenu({
      grip: request.anchorRect,
      block: blockRect,
      pageLeft: pageLeftOf(request.view.dom),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      menuHeight,
    }),
    wrapper,
    tint: {
      top: blockRect.top - origin.top - 2,
      left: blockRect.left - origin.left - 4,
      width: blockRect.width + 8,
      height: blockRect.height + 4,
    },
  };
}

export function BlockActionsMenu({
  editor,
  suggesting,
  onComment,
  onTurnTableIntoCollection,
  onTurnCollectionIntoTable,
  onCopyLink,
  documentId,
}: {
  editor: Editor;
  /** Suggested edits can't change a block's kind, colour, or settings. */
  suggesting: boolean;
  onComment?: BubbleToolbarProps["onComment"];
  onTurnTableIntoCollection?: (table: BlockAt) => void;
  onTurnCollectionIntoTable?: (collection: BlockAt) => void;
  onCopyLink?: (block: BlockAt) => void;
  /** The page, named to the agent a block is attached to. */
  documentId?: string | null;
}) {
  const t = useT();
  const [request, setRequest] = useState<DragHandleMenuRequest | null>(null);
  const [sheet, setSheet] = useState(false);
  const [sheetView, setSheetView] = useState<SheetView>("menu");
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const [layout, setLayout] = useState<BlockMenuLayout | null>(null);
  const [zone, setZone] = useState<HTMLSpanElement | null>(null);
  const menuHeightRef = useRef(BLOCK_MENU_HEIGHT);
  const escapedRef = useRef(false);
  const editorFocusRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const leftViewRef = useRef<SheetView | null>(null);
  const reasonId = useId();
  const moveBlock = useMoveBlock(editor, documentId);

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
        editorFocusRef.current = false;
        setQuery("");
        setSheet(opensAsSheet());
        setSheetView("menu");
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

  useLayoutEffect(() => {
    setLayout(
      request ? measureBlockMenu(request, menuHeightRef.current) : null,
    );
  }, [request, revision]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!request || !layout || sheet || !content) return;
    const height =
      content.scrollHeight + content.offsetHeight - content.clientHeight;
    if (Math.abs(height - menuHeightRef.current) < 1) return;
    menuHeightRef.current = height;
    setLayout(measureBlockMenu(request, height));
  }, [layout, request, sheet]);

  // Changing the sheet's view takes away the row that had focus. A view
  // focuses its chosen option, and Back focuses the row that opened the view.
  useLayoutEffect(() => {
    const left = leftViewRef.current;
    leftViewRef.current = null;
    const content = contentRef.current;
    if (!left || !content) return;
    const next =
      sheetView === "menu"
        ? content.querySelector<HTMLElement>(`[${OPENS_VIEW}="${left}"]`)
        : (content.querySelector<HTMLElement>(
            '[role="radio"][aria-checked="true"]',
          ) ?? content.querySelector<HTMLElement>('[role="radio"]'));
    (next ?? content).focus({ preventScroll: true });
  }, [sheetView]);

  if (!request || !layout) return moveBlock.dialog;

  const block = request.getBlock();
  const node = block?.node ?? null;
  const entry = node ? blockMenuEntry(node) : null;
  const title =
    node && entry ? entry.title(node, t) : t("editor.blockMenu.block");
  const turnTargets =
    !suggesting && node && canTurnInto(node) ? TURN_INTO_TARGETS : [];
  const currentTarget = node ? currentTurnIntoTarget(node) : null;
  const colorable = !suggesting && !!node && takesBlockColor(node.type.name);
  const color: string | null = node?.attrs.color ?? null;
  const commentRange =
    onComment && block ? blockCommentRange(block.node, block.pos) : null;
  const locks = block
    ? blockActionLocks(request.view.state, block.pos, block.node)
    : { duplicate: null, remove: null, move: null };
  const canDuplicate = !!block && !locks.duplicate;
  const canRemove = !!block && !locks.remove;

  const needle = query.trim().toLocaleLowerCase();
  const matches = (label: string) =>
    !needle || label.toLocaleLowerCase().includes(needle);
  const turnIntoLabel = t("editor.slash.turnInto");
  const colorLabel = t("editor.color.label");
  const foundTargets =
    needle && !matches(turnIntoLabel)
      ? turnTargets.filter((target) => matches(t(TURN_INTO[target].labelKey)))
      : turnTargets;

  const apple = isApplePlatform();
  const shortcut = (key: string, shift = false) => ({
    hint: apple
      ? `${shift ? "⇧" : ""}⌘${key}`
      : [
          t("editor.blockMenu.keyCtrl"),
          ...(shift ? [t("editor.blockMenu.keyShift")] : []),
          key,
        ].join("+"),
    aria: [apple ? "Meta" : "Control", ...(shift ? ["Shift"] : []), key].join(
      "+",
    ),
  });

  const close = () => {
    setRequest(null);
    request.onClose();
  };

  // An open sheet keeps focus inside it, so an action that focuses the editor
  // is pulled back, in some browsers before the editor sees it. This notes the
  // attempt, and the sheet passes focus on once it has gone.
  const runNotingFocus = (action: () => void) => {
    const { dom } = request.view;
    const tookFocus = (event: FocusEvent) => {
      const to = event.type === "focusin" ? event.target : event.relatedTarget;
      if (to instanceof Node && dom.contains(to)) {
        editorFocusRef.current = true;
      }
    };
    window.addEventListener("focusin", tookFocus, true);
    window.addEventListener("focusout", tookFocus, true);
    try {
      action();
    } finally {
      window.removeEventListener("focusin", tookFocus, true);
      window.removeEventListener("focusout", tookFocus, true);
    }
  };

  // The menu holds focus, and Content saves an unfocused change only when it
  // is marked as the user's. A setting applies while the block is still the
  // kind the menu opened on.
  const editBlock = (edit: (tr: Transaction, block: BlockAt) => void) => {
    const latest = request.getBlock();
    if (!node || latest?.node.type !== node.type) return;
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

  const setColor = (next: string | null) =>
    restyleBlock((tr, pos) => {
      if (!takesBlockColor(tr.doc.nodeAt(pos)?.type.name ?? "")) return false;
      tr.setNodeAttribute(pos, "color", next);
      return true;
    });

  const turnIntoCollection = () => {
    const latest = request.getBlock();
    if (latest?.node.type.name === "table") {
      onTurnTableIntoCollection?.(latest);
    }
  };

  const turnIntoTable = () => {
    const latest = request.getBlock();
    if (latest && isInlineCollection(latest.node)) {
      onTurnCollectionIntoTable?.(latest);
    }
  };

  const comment = () => {
    const latest = request.getBlock();
    const range = latest && blockCommentRange(latest.node, latest.pos);
    if (onComment && range) startCommentOnRange(editor, onComment, range);
  };

  // The agent gets the block as the page stores it, and the person says what
  // to do with it: nothing is sent until they do.
  const askAgent = () => {
    const latest = request.getBlock();
    if (!latest) return;
    const { doc } = request.view.state;
    let index = 0;
    doc.forEach((_child, offset, childIndex) => {
      if (offset === latest.pos) index = childIndex;
    });
    const nfm = docToNfm({ type: "doc", content: [latest.node.toJSON()] });
    const excerpt = nfm.slice(0, ASK_AGENT_MAX_CHARS);
    const fence = "~".repeat(Math.max(3, longestRun(excerpt, /~+/g) + 1));
    sendToAgentChat({
      // The chat drops a send whose message is empty, so a draft with only the
      // block attached needs one character; the composer trims it on send.
      message: " ",
      submit: false,
      openSidebar: true,
      contextLabel: blockMenuEntry(latest.node).title(latest.node, t),
      context: [
        "The user attached this block from the Content page they are editing, and will say what they want done with it.",
        documentId ? `Document ID: ${documentId}` : null,
        `Block type: ${latest.node.type.name}`,
        `Block position: ${index + 1} of ${doc.childCount} top-level blocks`,
        "",
        excerpt === nfm
          ? "The block as NFM:"
          : `The first ${ASK_AGENT_MAX_CHARS} characters of the block as NFM; read the document for the rest:`,
        fence,
        excerpt,
        fence,
      ]
        .filter((line) => line !== null)
        .join("\n"),
    });
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
        runNotingFocus(() => request.duplicate());
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
        runNotingFocus(() => request.remove());
        close();
      }
      return;
    }

    const target = event.target as HTMLElement;
    const search = searchRef.current;
    if (
      !search ||
      target === search ||
      target.closest("[data-radix-menu-content], [role='dialog']") !==
        event.currentTarget
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

  const lockReasonId = (lock: BlockLock | null | undefined) =>
    lock ? `${reasonId}-${lock}` : undefined;

  const switches =
    !suggesting && node && entry?.switches
      ? entry.switches(node, t).filter((option) => matches(option.label))
      : [];
  const showColor = colorable && matches(colorLabel);
  const colorChoices = blockColorChoices(t);
  const foundColor =
    colorable &&
    !!needle &&
    !showColor &&
    [...colorChoices.text, ...colorChoices.background].some(({ label }) =>
      matches(label),
    );
  const showTurnInto = !needle && turnTargets.length > 0;

  const shownActions = (actions: (BlockMenuAction | false)[]) =>
    block
      ? actions.filter(
          (action): action is BlockMenuAction =>
            !!action && matches(action.label),
        )
      : [];
  const convertActions = shownActions([
    !suggesting &&
      !!onTurnTableIntoCollection &&
      node?.type.name === "table" && {
        id: "turn-into-collection",
        label: t("editor.blockMenu.turnIntoCollection"),
        onSelect: turnIntoCollection,
        lock: locks.remove,
      },
    !suggesting &&
      !!onTurnCollectionIntoTable &&
      !!node &&
      isInlineCollection(node) && {
        id: "turn-into-table",
        label: t("editor.blockMenu.turnIntoTable"),
        onSelect: turnIntoTable,
        lock: locks.remove,
      },
  ]);
  const insertActions = shownActions([
    {
      id: "insert-above",
      label: t("editor.blockMenu.insertAbove"),
      onSelect: request.insertAbove,
    },
    {
      id: "insert-below",
      label: t("editor.blockMenu.insertBelow"),
      onSelect: request.insertBelow,
    },
  ]);
  const blockActions = shownActions([
    {
      id: "duplicate",
      label: t("editor.blockMenu.duplicate"),
      onSelect: request.duplicate,
      lock: locks.duplicate,
      shortcut: shortcut("D"),
    },
    !suggesting && {
      id: "move-to",
      label: t("editor.blockMenu.moveTo"),
      onSelect: () => {
        const latest = request.getBlock();
        if (latest) moveBlock.start(latest);
      },
      lock: locks.move,
    },
    !!onCopyLink && {
      id: "copy-link",
      label: t("editor.blockMenu.copyLink"),
      onSelect: () => {
        const latest = request.getBlock();
        if (latest) onCopyLink(latest);
      },
    },
    {
      id: "delete",
      label: t("editor.blockMenu.delete"),
      onSelect: request.remove,
      lock: locks.remove,
      destructive: true,
      shortcut: { hint: t("editor.blockMenu.keyDelete"), aria: "Delete" },
    },
  ]);
  const assistActions = shownActions([
    !!commentRange && {
      id: "comment",
      label: t("editor.comment"),
      onSelect: comment,
      shortcut: shortcut("M", true),
    },
    {
      id: "ask-agent",
      label: t("editor.blockMenu.askAgent"),
      onSelect: askAgent,
    },
  ]);

  const sections: BlockMenuSection[] = [];
  if (switches.length > 0) sections.push({ key: "switches", switches });
  if (needle && foundTargets.length > 0) {
    sections.push({ key: "found-turn-into", targets: foundTargets });
  }
  if (foundColor) sections.push({ key: "found-color" });
  if (showTurnInto || showColor) {
    sections.push({ key: "style", turnInto: showTurnInto, color: showColor });
  }
  for (const [key, actions] of [
    ["convert", convertActions],
    ["insert", insertActions],
    ["block", blockActions],
    ["assist", assistActions],
  ] as const) {
    if (actions.length > 0) sections.push({ key, actions });
  }

  // Each refused action's reason, once, after its group.
  const lockNotes = (actions: BlockMenuAction[]) =>
    [
      ...new Set(
        actions.flatMap((action) => (action.lock ? [action.lock] : [])),
      ),
    ].map((lock) => (
      <p
        key={lock}
        className="px-2 py-1 text-xs text-muted-foreground"
        id={lockReasonId(lock)}
      >
        {t(LOCK_REASON_KEYS[lock])}
      </p>
    ));

  const tint = layout.wrapper
    ? createPortal(
        <div
          aria-hidden="true"
          className="content-block-menu-tint"
          style={boxStyle(layout.tint)}
        />,
        layout.wrapper,
      )
    : null;

  const noResults =
    sections.length === 0 ? (
      <p className="px-2 py-1.5 text-xs text-muted-foreground">
        {t("editor.blockMenu.noResults")}
      </p>
    ) : null;

  if (sheet) {
    const sheetItem = { [SHEET_ITEM]: "" };

    const runAndClose = (action: () => void) => () => {
      runNotingFocus(action);
      close();
    };

    // A group of choices is one Tab stop, on its chosen option, and the arrow
    // keys move between them, as in any radio group. Moving doesn't choose,
    // though: a choice changes the block and closes the sheet.
    const sheetChoice = (
      key: string,
      label: ReactNode,
      checked: boolean,
      tabStop: boolean,
      onSelect: () => void,
    ) => (
      <button
        key={key}
        {...sheetItem}
        aria-checked={checked}
        className={sheetRowClass}
        onClick={runAndClose(onSelect)}
        role="radio"
        tabIndex={tabStop ? 0 : -1}
        type="button"
      >
        {label}
        {checked ? <IconCheck className="ms-auto size-4 shrink-0" /> : null}
      </button>
    );

    const moveInGroup = (event: KeyboardEvent<HTMLDivElement>) => {
      const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
      const steps: Partial<Record<string, number>> = {
        ArrowDown: 1,
        ArrowUp: -1,
        ArrowRight: rtl ? -1 : 1,
        ArrowLeft: rtl ? 1 : -1,
      };
      const step = steps[event.key];
      const choices = Array.from(
        event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'),
      );
      const index = choices.indexOf(event.target as HTMLElement);
      if (step === undefined || index < 0) return;
      event.preventDefault();
      event.stopPropagation();
      choices[(index + step + choices.length) % choices.length]?.focus();
    };

    const turnIntoChoices = (targets: readonly TurnIntoTarget[]) => {
      const stop =
        currentTarget && targets.includes(currentTarget)
          ? currentTarget
          : targets[0];
      return (
        <div
          aria-label={turnIntoLabel}
          onKeyDown={moveInGroup}
          role="radiogroup"
        >
          {targets.map((target) =>
            sheetChoice(
              target,
              t(TURN_INTO[target].labelKey),
              target === currentTarget,
              target === stop,
              () => turnInto(target),
            ),
          )}
        </div>
      );
    };

    // A block has one colour, so each group's default stands for "not one of
    // mine". Search results show the colours that match; Color's own view, which
    // a search for "Color" itself reaches, shows them all.
    const background = !!color?.endsWith("_bg");
    const colorGroups = (shown: (label: string) => boolean) =>
      (
        [
          [
            "text",
            t("editor.textColor"),
            colorChoices.text,
            color && !background ? color : "default",
          ],
          [
            "background",
            t("editor.backgroundColor"),
            colorChoices.background,
            background ? color : "default_bg",
          ],
        ] as const
      ).map(([group, label, choices, chosen]) => {
        const found = choices.filter((choice) => shown(choice.label));
        if (found.length === 0) return null;
        const stop = found.some((choice) => choice.color === chosen)
          ? chosen
          : found[0]?.color;
        return (
          <div
            key={group}
            aria-label={label}
            onKeyDown={moveInGroup}
            role="radiogroup"
          >
            <p aria-hidden="true" className={sheetLabelClass}>
              {label}
            </p>
            {found.map(({ color: choice, label: choiceLabel }) =>
              sheetChoice(
                choice,
                <>
                  <ColorSwatch color={choice} />
                  {choiceLabel}
                </>,
                chosen === choice,
                stop === choice,
                () => setColor(chosenColor(color, choice)),
              ),
            )}
          </div>
        );
      });

    const showView = (view: SheetView) => {
      leftViewRef.current = sheetView;
      setSheetView(view);
    };

    const opensView = (label: string, view: Exclude<SheetView, "menu">) => (
      <button
        {...sheetItem}
        {...{ [OPENS_VIEW]: view }}
        className={sheetRowClass}
        onClick={() => showView(view)}
        type="button"
      >
        {label}
        <IconChevronRight className="ms-auto size-4 shrink-0 text-muted-foreground rtl:-scale-x-100" />
      </button>
    );

    const sheetSection = (section: BlockMenuSection): ReactNode => {
      switch (section.key) {
        case "switches":
          return section.switches.map((option) => (
            <label key={option.id} className={sheetRowClass}>
              {option.label}
              <Switch
                {...sheetItem}
                checked={option.checked}
                className="ms-auto"
                onCheckedChange={() => editBlock(option.toggle)}
              />
            </label>
          ));
        case "found-turn-into":
          return (
            <>
              <p aria-hidden="true" className={sheetLabelClass}>
                {turnIntoLabel}
              </p>
              {turnIntoChoices(section.targets)}
            </>
          );
        case "found-color":
          return colorGroups(matches);
        case "style":
          return (
            <>
              {section.turnInto ? opensView(turnIntoLabel, "turn-into") : null}
              {section.color ? opensView(colorLabel, "color") : null}
            </>
          );
        case "convert":
        case "insert":
        case "block":
        case "assist":
          return (
            <>
              {section.actions.map((action) => (
                <button
                  key={action.id}
                  {...sheetItem}
                  aria-describedby={lockReasonId(action.lock)}
                  aria-keyshortcuts={action.shortcut?.aria}
                  className={cn(
                    sheetRowClass,
                    action.destructive && "text-destructive",
                  )}
                  disabled={!!action.lock}
                  onClick={runAndClose(action.onSelect)}
                  type="button"
                >
                  {action.label}
                </button>
              ))}
              {lockNotes(section.actions)}
            </>
          );
      }
    };

    const subView =
      sheetView === "turn-into" && turnTargets.length > 0
        ? { label: turnIntoLabel, body: turnIntoChoices(turnTargets) }
        : sheetView === "color" && colorable
          ? { label: colorLabel, body: colorGroups(() => true) }
          : null;

    return (
      <Sheet
        onOpenChange={(open) => {
          if (open) return;
          close();
        }}
        open
      >
        {tint}
        <SheetContent
          ref={contentRef}
          aria-describedby={undefined}
          className="flex max-h-[85dvh] flex-col gap-0 rounded-t-xl p-0 pb-[env(safe-area-inset-bottom)]"
          // An action that focused the editor gets it back, and Escape puts the
          // caret in the block, as the menu's does. A tap outside leaves the
          // phone's keyboard down.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const escaped = escapedRef.current;
            const toEditor = editorFocusRef.current;
            escapedRef.current = false;
            editorFocusRef.current = false;
            if (toEditor) request.view.focus();
            else if (escaped) returnToBlock();
          }}
          onEscapeKeyDown={markEscaped}
          onKeyDown={handleMenuKeyDown}
          // The phone's keyboard stays down until the search is tapped. Focus
          // still moves into the sheet, so a keyboard can reach its rows.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            contentRef.current?.focus({ preventScroll: true });
          }}
          showClose={false}
          side="bottom"
        >
          <SheetTitle className="sr-only">
            {t("editor.blockMenu.label")}
          </SheetTitle>
          {subView ? (
            <>
              <div className="flex items-center gap-1 border-b border-border/70 p-1">
                <button
                  aria-label={t("database.back")}
                  className="flex size-11 shrink-0 items-center justify-center rounded-md outline-none focus-visible:bg-accent active:bg-accent"
                  onClick={() => showView("menu")}
                  type="button"
                >
                  <IconChevronLeft className="size-5 rtl:-scale-x-100" />
                </button>
                <p className="text-sm font-medium">{subView.label}</p>
              </div>
              <div className="overflow-y-auto p-2">{subView.body}</div>
            </>
          ) : (
            <>
              <div className="border-b border-border/70 p-2">
                <div className="flex min-h-11 items-center gap-2 px-3">
                  <IconSearch className="size-4 shrink-0 text-muted-foreground" />
                  <input
                    ref={searchInput}
                    aria-label={t("editor.blockMenu.search")}
                    className={cn(menuSearchInputClass, "h-8 text-base")}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    placeholder={t("editor.blockMenu.search")}
                    value={query}
                  />
                </div>
              </div>
              <div className="overflow-y-auto p-2">
                <p className={sheetLabelClass}>{title}</p>
                {sections.map((section, index) => (
                  <Fragment key={section.key}>
                    {index > 0 ? <Separator className="my-1" /> : null}
                    {sheetSection(section)}
                  </Fragment>
                ))}
                {noResults}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    );
  }

  const turnIntoItem = (target: TurnIntoTarget) => {
    const { labelKey } = TURN_INTO[target];
    const checked = target === currentTarget;
    return (
      <DropdownMenuItem
        key={target}
        aria-checked={checked}
        onSelect={() => turnInto(target)}
        role="menuitemradio"
      >
        {t(labelKey)}
        {checked ? <IconCheck className="ms-auto size-4 shrink-0" /> : null}
      </DropdownMenuItem>
    );
  };

  const menuSection = (section: BlockMenuSection): ReactNode => {
    switch (section.key) {
      case "switches":
        return section.switches.map((option) => (
          <MenuSwitchItem
            key={option.id}
            checked={option.checked}
            onToggle={() => editBlock(option.toggle)}
          >
            {option.label}
          </MenuSwitchItem>
        ));
      case "found-turn-into":
        return (
          <>
            <DropdownMenuLabel>{turnIntoLabel}</DropdownMenuLabel>
            {section.targets.map(turnIntoItem)}
          </>
        );
      case "found-color":
        return (
          <ColorChoices value={color} onChange={setColor} shows={matches} />
        );
      case "style":
        return (
          <>
            {section.turnInto ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>{turnIntoLabel}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  className={cn(
                    "max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto",
                    instantCloseMenuClass,
                  )}
                  collisionBoundary={zone}
                  collisionPadding={BLOCK_MENU_PADDING}
                  onEscapeKeyDown={markEscaped}
                >
                  {turnTargets.map(turnIntoItem)}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
            {section.color ? (
              <ColorSubmenu
                collisionBoundary={zone}
                value={color}
                onChange={setColor}
                onEscapeKeyDown={markEscaped}
              />
            ) : null}
          </>
        );
      case "convert":
      case "insert":
      case "block":
      case "assist":
        return (
          <>
            {section.actions.map((action) => (
              <DropdownMenuItem
                key={action.id}
                aria-describedby={lockReasonId(action.lock)}
                aria-keyshortcuts={action.shortcut?.aria}
                className={
                  action.destructive
                    ? "text-destructive focus:text-destructive"
                    : undefined
                }
                disabled={!!action.lock}
                onSelect={action.onSelect}
              >
                {action.label}
                {action.shortcut ? (
                  <DropdownMenuShortcut className={hintClass}>
                    {action.shortcut.hint}
                  </DropdownMenuShortcut>
                ) : null}
              </DropdownMenuItem>
            ))}
            {lockNotes(section.actions)}
          </>
        );
    }
  };

  const { placement } = layout;

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (open) return;
        close();
      }}
      open
    >
      {tint}
      <span
        ref={setZone}
        aria-hidden="true"
        className="pointer-events-none invisible fixed"
        style={boxStyle(placement.zone)}
      />
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          className="pointer-events-none fixed"
          style={boxStyle(placement.anchor)}
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
        collisionBoundary={zone}
        collisionPadding={BLOCK_MENU_PADDING}
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
        side={placement.side}
        sideOffset={BLOCK_MENU_GAP}
      >
        <div className="flex h-8 items-center gap-1.5 px-1.5">
          <IconSearch className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchInput}
            aria-label={t("editor.blockMenu.search")}
            className={menuSearchInputClass}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={t("editor.blockMenu.search")}
            value={query}
          />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{title}</DropdownMenuLabel>
        {sections.map((section, index) => (
          <Fragment key={section.key}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            {menuSection(section)}
          </Fragment>
        ))}
        {noResults}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
