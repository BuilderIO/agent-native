import { useT } from "@agent-native/core/client/i18n";
import {
  IconBlockquote,
  IconH1,
  IconH2,
  IconH3,
  IconLetterT,
  IconList,
  IconListNumbers,
  IconMinus,
} from "@tabler/icons-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  isBulletMarker,
  isBulletRow,
  rowTextRange,
} from "@/components/editor/bullet-editing";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";

import type {
  InPlaceTextAuthoringCommand,
  InPlaceTextSession,
} from "./in-place-text-session";

const BLOCK_TAGS = new Set([
  "BLOCKQUOTE",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "P",
]);

const ZERO_WIDTH_SPACE = "\u200b";
const NO_MATCH_CLOSE_LENGTH = 3;

const COMMANDS: {
  kind: InPlaceTextAuthoringCommand;
  aliases: string[];
  label: (translate: ReturnType<typeof useT>) => string;
  description: (translate: ReturnType<typeof useT>) => string;
  icon: typeof IconLetterT;
}[] = [
  {
    kind: "paragraph",
    aliases: ["p", "text", "paragraph"],
    label: (translate) => translate("slideSlashMenu.text"),
    description: (translate) => translate("slideSlashMenu.plainParagraph"),
    icon: IconLetterT,
  },
  {
    kind: "heading1",
    aliases: ["h1", "#", "heading", "heading 1", "heading1"],
    label: (translate) => translate("slideSlashMenu.heading1"),
    description: (translate) => translate("slideSlashMenu.largeSlideHeading"),
    icon: IconH1,
  },
  {
    kind: "heading2",
    aliases: ["h2", "##", "heading", "heading 2", "heading2"],
    label: (translate) => translate("slideSlashMenu.heading2"),
    description: (translate) => translate("slideSlashMenu.mediumHeading"),
    icon: IconH2,
  },
  {
    kind: "heading3",
    aliases: ["h3", "###", "heading", "heading 3", "heading3"],
    label: (translate) => translate("slideSlashMenu.heading3"),
    description: (translate) => translate("slideSlashMenu.smallHeading"),
    icon: IconH3,
  },
  {
    kind: "bulletList",
    aliases: ["ul", "bullet", "bullet list", "bulleted list", "-", "*", "+"],
    label: (translate) => translate("slideSlashMenu.bulletList"),
    description: (translate) => translate("slideSlashMenu.unorderedList"),
    icon: IconList,
  },
  {
    kind: "orderedList",
    aliases: ["ol", "number", "numbered list", "ordered list", "1.", "1)"],
    label: (translate) => translate("slideSlashMenu.numberedList"),
    description: (translate) => translate("slideSlashMenu.orderedList"),
    icon: IconListNumbers,
  },
  {
    kind: "quote",
    aliases: ["quote", "blockquote", "block quote", ">"],
    label: (translate) => translate("slideSlashMenu.quote"),
    description: (translate) => translate("slideSlashMenu.blockquote"),
    icon: IconBlockquote,
  },
  {
    kind: "divider",
    aliases: ["hr", "divider", "rule", "horizontal rule", "---", "***", "___"],
    label: (translate) => translate("slideSlashMenu.divider"),
    description: (translate) => translate("slideSlashMenu.horizontalRule"),
    icon: IconMinus,
  },
];

interface SlashMenuState {
  query: string;
  range: Range;
  anchorRect: DOMRect;
}

interface SlideSlashCommandMenuProps {
  editingEl: HTMLElement | null;
  textSession: InPlaceTextSession | null;
}

function pointAt(root: Node, offset: number): [Node, number] {
  let remaining = offset;
  let last: Text | null = null;
  let lastBreak: [Node, number] | null = null;
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      if (element.tagName !== "BR") continue;
      const parent = element.parentNode!;
      const after = Array.from(parent.childNodes).indexOf(element) + 1;
      if (remaining === 0) {
        if (lastBreak) return lastBreak;
        return last ? [last, last.length] : [parent, after - 1];
      }
      remaining -= 1;
      lastBreak = [parent, after];
      continue;
    }
    const text = node as Text;
    if (remaining <= text.length) return [text, remaining];
    remaining -= text.length;
    last = text;
  }
  return (
    lastBreak ?? (last ? [last, last.length] : [root, root.childNodes.length])
  );
}

function visibleOffset(raw: string, offset: number) {
  let visible = 0;
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] === ZERO_WIDTH_SPACE) continue;
    if (visible === offset) return index;
    visible += 1;
  }
  return raw.length;
}

function fuzzyMatches(value: string, query: string) {
  let queryIndex = 0;
  const needle = query.toLowerCase();
  for (const character of value.toLowerCase()) {
    if (character === needle[queryIndex]) queryIndex += 1;
    if (queryIndex === needle.length) return true;
  }
  return needle.length === 0;
}

function caretPrefix(editingEl: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount !== 1 || !selection.isCollapsed) {
    return null;
  }
  const caret = selection.getRangeAt(0);
  if (!editingEl.contains(caret.startContainer)) return null;

  let block =
    caret.startContainer instanceof HTMLElement
      ? caret.startContainer
      : caret.startContainer.parentElement;
  while (block && block !== editingEl && !BLOCK_TAGS.has(block.tagName)) {
    block = block.parentElement;
  }
  block ??= editingEl;

  let start: [Node, number] = [block, 0];
  if (isBulletRow(block)) {
    const marker =
      block.firstElementChild instanceof HTMLElement &&
      isBulletMarker(block.firstElementChild)
        ? block.firstElementChild
        : null;
    const textRange = rowTextRange(block, marker);
    start = [textRange.startContainer, textRange.startOffset];
  }
  const beforeCaret = document.createRange();
  beforeCaret.setStart(block, 0);
  beforeCaret.setEnd(caret.startContainer, caret.startOffset);
  for (const br of Array.from(block.querySelectorAll("br"))) {
    const parent = br.parentNode!;
    const after = Array.from(parent.childNodes).indexOf(br) + 1;
    if (beforeCaret.comparePoint(parent, after) === 0) start = [parent, after];
  }
  const prefix = document.createRange();
  prefix.setStart(...start);
  prefix.setEnd(caret.startContainer, caret.startOffset);
  return { block, caret, raw: prefix.toString(), start };
}

function canStartSlash(editingEl: HTMLElement) {
  const context = caretPrefix(editingEl);
  if (!context) return false;
  const text = context.raw.replaceAll(ZERO_WIDTH_SPACE, "");
  return text.length === 0 || /\s$/.test(text);
}

function findMenu(editingEl: HTMLElement): SlashMenuState | null {
  const context = caretPrefix(editingEl);
  if (!context) return null;
  const { block, caret, raw, start } = context;
  const text = raw.replaceAll(ZERO_WIDTH_SPACE, "");
  const slash = text.lastIndexOf("/");
  if (slash < 0 || (slash > 0 && !/\s/.test(text[slash - 1]))) {
    return null;
  }
  const query = text.slice(slash + 1);
  if (/^\s/.test(query)) return null;

  const base = document.createRange();
  base.setStart(block, 0);
  base.setEnd(...start);
  let breakOffset = 0;
  for (const br of Array.from(block.querySelectorAll("br"))) {
    const parent = br.parentNode!;
    const after = Array.from(parent.childNodes).indexOf(br) + 1;
    if (base.comparePoint(parent, after) === 0) breakOffset += 1;
  }
  const startOffset = base.toString().length + breakOffset;
  const offset = visibleOffset(raw, slash);
  const range = document.createRange();
  range.setStart(...pointAt(block, startOffset + offset));
  range.setEnd(caret.startContainer, caret.startOffset);

  const caretRect = caret.getBoundingClientRect();
  const slashRect = range.cloneRange();
  slashRect.setEnd(...pointAt(block, startOffset + offset + 1));
  const rect =
    caretRect.width || caretRect.height
      ? caretRect
      : slashRect.getBoundingClientRect();
  if (!Number.isFinite(rect.left) || !Number.isFinite(rect.bottom)) return null;

  return {
    query,
    range,
    anchorRect: rect,
  };
}

export function SlideSlashCommandMenu({
  editingEl,
  textSession,
}: SlideSlashCommandMenuProps) {
  const t = useT();
  const [menu, setMenu] = useState<SlashMenuState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const menuId = `slide-slash-${useId().replaceAll(":", "")}`;
  const listboxId = `${menuId}-listbox`;
  const optionId = (kind: InPlaceTextAuthoringCommand) =>
    `${menuId}-option-${kind}`;
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const pendingSlash = useRef(false);
  const [popoverContent, setPopoverContent] = useState<HTMLDivElement | null>(
    null,
  );
  const virtualAnchor = useMemo(
    () => ({
      current: {
        get contextElement() {
          return editingEl ?? document.body;
        },
        getBoundingClientRect: () => menu?.anchorRect ?? new DOMRect(),
      },
    }),
    [editingEl, menu?.anchorRect],
  );
  const originalAttributes = useRef<{
    element: HTMLElement;
    values: Map<string, string | null>;
  } | null>(null);
  const restoreOriginalAttributes = () => {
    const saved = originalAttributes.current;
    if (!saved) return;
    for (const [name, value] of saved.values) {
      if (value === null) saved.element.removeAttribute(name);
      else saved.element.setAttribute(name, value);
    }
    originalAttributes.current = null;
  };
  const applyAuthoringCommand = (
    kind: InPlaceTextAuthoringCommand,
    range: Range,
  ) => {
    restoreOriginalAttributes();
    textSession?.commands.applyAuthoringCommand(kind, range);
    menuRef.current = null;
    pendingSlash.current = false;
    setMenu(null);
  };
  const matches = useMemo(() => {
    const query = menu?.query.replace(/\s+/gu, " ").toLowerCase() ?? "";
    if (!query) return COMMANDS;
    const exactAliases = COMMANDS.filter((command) =>
      command.aliases.includes(query),
    );
    if (exactAliases.length) return exactAliases;
    const startsWithWord = (value: string) =>
      value
        .toLowerCase()
        .split(/\s+/)
        .some((word) => word.startsWith(query));
    const prefixes = COMMANDS.filter(
      (command) =>
        command.aliases.some(startsWithWord) ||
        startsWithWord(`${command.label(t)} ${command.description(t)}`),
    );
    if (prefixes.length) return prefixes;
    return COMMANDS.filter(
      (command) =>
        fuzzyMatches(`${command.label(t)} ${command.description(t)}`, query) ||
        command.aliases.some((alias) => fuzzyMatches(alias, query)),
    );
  }, [menu?.query, t]);
  const filtered =
    matches.length > 0 || (menu?.query.length ?? 0) >= NO_MATCH_CLOSE_LENGTH
      ? matches
      : COMMANDS;
  const selectedIndex = filtered.length ? activeIndex % filtered.length : 0;
  const activeCommand = filtered[selectedIndex];

  useEffect(() => {
    if (!editingEl || !textSession?.isActive) {
      menuRef.current = null;
      pendingSlash.current = false;
      setMenu(null);
      return;
    }
    const refreshOpenMenu = (forceUpdate = false) => {
      const current = menuRef.current;
      if (!current) return;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const next = findMenu(editingEl);
      if (
        !next ||
        current.range.startContainer !== next.range.startContainer ||
        current.range.startOffset !== next.range.startOffset
      ) {
        menuRef.current = null;
        setMenu(null);
        return;
      }
      if (
        !forceUpdate &&
        current.query === next.query &&
        current.range.endContainer === next.range.endContainer &&
        current.range.endOffset === next.range.endOffset &&
        current.anchorRect.left === next.anchorRect.left &&
        current.anchorRect.top === next.anchorRect.top &&
        current.anchorRect.right === next.anchorRect.right &&
        current.anchorRect.bottom === next.anchorRect.bottom
      ) {
        return;
      }
      menuRef.current = next;
      setMenu(next);
    };
    const onBeforeInput = (event: Event) => {
      const input = event as InputEvent;
      pendingSlash.current =
        input.inputType === "insertText" &&
        input.data === "/" &&
        !input.isComposing &&
        canStartSlash(editingEl);
      if (pendingSlash.current) {
        queueMicrotask(() => {
          if (!pendingSlash.current) return;
          const next = findMenu(editingEl);
          if (!next) return;
          pendingSlash.current = false;
          menuRef.current = next;
          setMenu(next);
        });
      }
    };
    const onInput = (event: Event) => {
      const input = event as InputEvent;
      const opensMenu =
        pendingSlash.current &&
        input.inputType === "insertText" &&
        input.data === "/" &&
        !input.isComposing;
      pendingSlash.current = false;
      if (opensMenu) {
        const next = findMenu(editingEl);
        menuRef.current = next;
        setMenu(next);
      } else {
        refreshOpenMenu(true);
      }
    };
    const refreshGeometry = () => {
      if (menuRef.current) refreshOpenMenu();
    };
    editingEl.addEventListener("beforeinput", onBeforeInput, true);
    editingEl.addEventListener("input", onInput);
    document.addEventListener("selectionchange", refreshGeometry);
    window.addEventListener("scroll", refreshGeometry, true);
    window.addEventListener("resize", refreshGeometry);
    return () => {
      editingEl.removeEventListener("beforeinput", onBeforeInput, true);
      editingEl.removeEventListener("input", onInput);
      document.removeEventListener("selectionchange", refreshGeometry);
      window.removeEventListener("scroll", refreshGeometry, true);
      window.removeEventListener("resize", refreshGeometry);
    };
  }, [editingEl, textSession]);

  useEffect(() => setActiveIndex(0), [menu?.query]);

  useEffect(() => {
    if (
      menu &&
      menu.query.length >= NO_MATCH_CLOSE_LENGTH &&
      matches.length === 0
    ) {
      menuRef.current = null;
      setMenu(null);
    }
  }, [matches.length, menu]);

  useLayoutEffect(() => {
    if (!editingEl) return;
    if (
      originalAttributes.current &&
      originalAttributes.current.element !== editingEl
    ) {
      restoreOriginalAttributes();
    }
    if (menu && activeCommand) {
      const listbox = popoverContent?.querySelector<HTMLElement>("[cmdk-list]");
      const options = Array.from(
        popoverContent?.querySelectorAll<HTMLElement>("[cmdk-item]") ?? [],
      );
      const activeOption = options.find(
        (item) => item.getAttribute("data-value") === activeCommand.kind,
      );
      if (!listbox || !activeOption) return;
      // cmdk owns generated IDs; expose per-menu IDs to the editable instead.
      listbox.id = listboxId;
      for (const option of options) {
        const kind = option.getAttribute("data-value");
        if (kind) option.id = optionId(kind as InPlaceTextAuthoringCommand);
      }
      const activeOptionId = optionId(activeCommand.kind);
      activeOption.id = activeOptionId;
      listbox.setAttribute("aria-activedescendant", activeOptionId);
      if (originalAttributes.current?.element !== editingEl) {
        originalAttributes.current = {
          element: editingEl,
          values: new Map(
            [
              "role",
              "aria-haspopup",
              "aria-autocomplete",
              "aria-expanded",
              "aria-controls",
              "aria-activedescendant",
            ].map((name) => [name, editingEl.getAttribute(name)]),
          ),
        };
      }
      editingEl.setAttribute("role", "combobox");
      editingEl.setAttribute("aria-haspopup", "listbox");
      editingEl.setAttribute("aria-autocomplete", "list");
      editingEl.setAttribute("aria-expanded", "true");
      editingEl.setAttribute("aria-controls", listboxId);
      editingEl.setAttribute("aria-activedescendant", activeOptionId);
      return;
    }
    if (originalAttributes.current?.element === editingEl) {
      restoreOriginalAttributes();
    }
  }, [activeCommand, editingEl, listboxId, menu, popoverContent]);

  useLayoutEffect(() => {
    if (!activeCommand) return;
    const activeOption = Array.from(
      popoverContent?.querySelectorAll<HTMLElement>("[cmdk-item]") ?? [],
    ).find((item) => item.getAttribute("data-value") === activeCommand.kind);
    activeOption?.scrollIntoView({ block: "nearest" });
  }, [activeCommand, menu?.query, popoverContent]);

  useEffect(
    () => () => {
      const saved = originalAttributes.current;
      if (saved?.element !== editingEl) return;
      for (const [name, value] of saved.values) {
        if (value === null) editingEl.removeAttribute(name);
        else editingEl.setAttribute(name, value);
      }
      originalAttributes.current = null;
    },
    [editingEl],
  );

  useEffect(() => {
    if (!editingEl || !menu) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setActiveIndex((index) =>
          event.key === "ArrowDown"
            ? (index + 1) % filtered.length
            : (index + filtered.length - 1) % filtered.length,
        );
      } else if (event.key === "Enter" && activeCommand) {
        event.preventDefault();
        event.stopImmediatePropagation();
        applyAuthoringCommand(activeCommand.kind, menu.range.cloneRange());
      } else if (event.key === "Tab" && activeCommand) {
        event.preventDefault();
        event.stopImmediatePropagation();
        applyAuthoringCommand(activeCommand.kind, menu.range.cloneRange());
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        pendingSlash.current = false;
        menuRef.current = null;
        setMenu(null);
      }
    };
    editingEl.addEventListener("keydown", onKeyDown, true);
    return () => editingEl.removeEventListener("keydown", onKeyDown, true);
  }, [activeCommand, editingEl, filtered.length, menu, textSession]);

  if (!editingEl || !menu) return null;

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) {
          menuRef.current = null;
          setMenu(null);
        }
      }}
    >
      <PopoverAnchor virtualRef={virtualAnchor} />
      <PopoverContent
        ref={setPopoverContent}
        align="start"
        side="bottom"
        sideOffset={4}
        collisionPadding={8}
        className="w-64"
        data-slide-inline-edit-surface="true"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (event.pointerType !== "touch") event.preventDefault();
        }}
      >
        <div className="-m-4 p-1">
          <Command
            value={activeCommand?.kind ?? ""}
            onValueChange={(value) => {
              const index = filtered.findIndex((item) => item.kind === value);
              if (index >= 0) setActiveIndex(index);
            }}
            shouldFilter={false}
          >
            <CommandList label={t("slideSlashMenu.blocks")}>
              <CommandGroup heading={t("slideSlashMenu.blocks")}>
                {filtered.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <CommandItem
                      key={item.kind}
                      value={item.kind}
                      onMouseEnter={() => setActiveIndex(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onPointerDown={(event) => event.preventDefault()}
                      onSelect={() => {
                        applyAuthoringCommand(
                          item.kind,
                          menu.range.cloneRange(),
                        );
                      }}
                    >
                      <span className="flex w-full items-center gap-3 py-px">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded bg-accent/50">
                          <Icon className="size-4" />
                        </span>
                        <span className="min-w-0 text-left">
                          <span className="block text-sm font-medium leading-tight">
                            {item.label(t)}
                          </span>
                          <span className="block text-xs leading-tight text-muted-foreground">
                            {item.description(t)}
                          </span>
                        </span>
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      </PopoverContent>
    </Popover>
  );
}
