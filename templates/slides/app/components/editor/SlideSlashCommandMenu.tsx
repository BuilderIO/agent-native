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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

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

const COMMANDS: {
  kind: InPlaceTextAuthoringCommand;
  label: (translate: ReturnType<typeof useT>) => string;
  description: (translate: ReturnType<typeof useT>) => string;
  icon: typeof IconLetterT;
}[] = [
  {
    kind: "paragraph",
    label: (translate) => translate("slideSlashMenu.text"),
    description: (translate) => translate("slideSlashMenu.plainParagraph"),
    icon: IconLetterT,
  },
  {
    kind: "heading1",
    label: (translate) => translate("slideSlashMenu.heading1"),
    description: (translate) => translate("slideSlashMenu.largeSlideHeading"),
    icon: IconH1,
  },
  {
    kind: "heading2",
    label: (translate) => translate("slideSlashMenu.heading2"),
    description: (translate) => translate("slideSlashMenu.mediumHeading"),
    icon: IconH2,
  },
  {
    kind: "heading3",
    label: (translate) => translate("slideSlashMenu.heading3"),
    description: (translate) => translate("slideSlashMenu.smallHeading"),
    icon: IconH3,
  },
  {
    kind: "bulletList",
    label: (translate) => translate("slideSlashMenu.bulletList"),
    description: (translate) => translate("slideSlashMenu.unorderedList"),
    icon: IconList,
  },
  {
    kind: "orderedList",
    label: (translate) => translate("slideSlashMenu.numberedList"),
    description: (translate) => translate("slideSlashMenu.orderedList"),
    icon: IconListNumbers,
  },
  {
    kind: "quote",
    label: (translate) => translate("slideSlashMenu.quote"),
    description: (translate) => translate("slideSlashMenu.blockquote"),
    icon: IconBlockquote,
  },
  {
    kind: "divider",
    label: (translate) => translate("slideSlashMenu.divider"),
    description: (translate) => translate("slideSlashMenu.horizontalRule"),
    icon: IconMinus,
  },
];

interface SlashMenuState {
  query: string;
  range: Range;
  left: number;
  top: number;
}

interface SlideSlashCommandMenuProps {
  editingEl: HTMLElement | null;
  textSession: InPlaceTextSession | null;
}

function pointAt(root: Node, offset: number): [Node, number] {
  let remaining = offset;
  let last: Text | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (remaining <= text.length) return [text, remaining];
    remaining -= text.length;
    last = text;
  }
  return last ? [last, last.length] : [root, root.childNodes.length];
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

function findMenu(editingEl: HTMLElement): SlashMenuState | null {
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
  const raw = prefix.toString();
  const text = raw.replaceAll(ZERO_WIDTH_SPACE, "");
  const slash = text.lastIndexOf("/");
  if (slash < 0 || text.slice(0, slash).trim()) return null;
  const query = text.slice(slash + 1);

  const base = document.createRange();
  base.setStart(block, 0);
  base.setEnd(...start);
  const startOffset = base.toString().length;
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
    left: rect.left,
    top: rect.bottom,
  };
}

export function SlideSlashCommandMenu({
  editingEl,
  textSession,
}: SlideSlashCommandMenuProps) {
  const t = useT();
  const [menu, setMenu] = useState<SlashMenuState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const originalAria = useRef<{
    element: HTMLElement;
    values: Map<string, string | null>;
  } | null>(null);
  const filtered = useMemo(
    () =>
      COMMANDS.filter((command) => {
        const search =
          `${command.label(t)} ${command.description(t)}`.toLowerCase();
        return search.includes(menu?.query.toLowerCase() ?? "");
      }),
    [menu?.query, t],
  );
  const selectedIndex = filtered.length ? activeIndex % filtered.length : 0;
  const activeCommand = filtered[selectedIndex];
  const activeId = activeCommand
    ? `slide-slash-${activeCommand.kind}`
    : undefined;

  useEffect(() => {
    if (!editingEl || !textSession?.isActive) {
      setMenu(null);
      return;
    }
    const refresh = () => {
      const next = findMenu(editingEl);
      setMenu((current) => {
        if (!current || !next) return next;
        if (
          current.query === next.query &&
          current.range.startContainer === next.range.startContainer &&
          current.range.startOffset === next.range.startOffset &&
          current.range.endContainer === next.range.endContainer &&
          current.range.endOffset === next.range.endOffset &&
          current.left === next.left &&
          current.top === next.top
        ) {
          return current;
        }
        return next;
      });
    };
    editingEl.addEventListener("input", refresh);
    document.addEventListener("selectionchange", refresh);
    window.addEventListener("scroll", refresh, true);
    window.addEventListener("resize", refresh);
    refresh();
    return () => {
      editingEl.removeEventListener("input", refresh);
      document.removeEventListener("selectionchange", refresh);
      window.removeEventListener("scroll", refresh, true);
      window.removeEventListener("resize", refresh);
    };
  }, [editingEl, textSession]);

  useEffect(() => setActiveIndex(0), [menu?.query]);

  useEffect(() => {
    if (menu && filtered.length === 0) setMenu(null);
  }, [filtered.length, menu]);

  useLayoutEffect(() => {
    if (!editingEl) return;
    if (originalAria.current && originalAria.current.element !== editingEl) {
      for (const [name, value] of originalAria.current.values) {
        if (value === null) originalAria.current.element.removeAttribute(name);
        else originalAria.current.element.setAttribute(name, value);
      }
      originalAria.current = null;
    }
    if (menu && activeId) {
      if (originalAria.current?.element !== editingEl) {
        originalAria.current = {
          element: editingEl,
          values: new Map(
            [
              "aria-haspopup",
              "aria-autocomplete",
              "aria-expanded",
              "aria-controls",
              "aria-activedescendant",
            ].map((name) => [name, editingEl.getAttribute(name)]),
          ),
        };
      }
      editingEl.setAttribute("aria-haspopup", "listbox");
      editingEl.setAttribute("aria-autocomplete", "list");
      editingEl.setAttribute("aria-expanded", "true");
      editingEl.setAttribute("aria-controls", "slide-slash-command-list");
      editingEl.setAttribute("aria-activedescendant", activeId);
      return;
    }
    if (originalAria.current?.element === editingEl) {
      for (const [name, value] of originalAria.current.values) {
        if (value === null) editingEl.removeAttribute(name);
        else editingEl.setAttribute(name, value);
      }
      originalAria.current = null;
    }
  }, [activeId, editingEl, menu]);

  useEffect(
    () => () => {
      const saved = originalAria.current;
      if (saved?.element !== editingEl) return;
      for (const [name, value] of saved.values) {
        if (value === null) editingEl.removeAttribute(name);
        else editingEl.setAttribute(name, value);
      }
      originalAria.current = null;
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
        textSession?.commands.applyAuthoringCommand(
          activeCommand.kind,
          menu.range.cloneRange(),
        );
        setMenu(null);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setMenu(null);
      }
    };
    editingEl.addEventListener("keydown", onKeyDown, true);
    return () => editingEl.removeEventListener("keydown", onKeyDown, true);
  }, [activeCommand, editingEl, filtered.length, menu, textSession]);

  if (!editingEl || !menu || filtered.length === 0) return null;

  return (
    <Popover open onOpenChange={(open) => !open && setMenu(null)}>
      <PopoverAnchor asChild>
        <span
          aria-hidden="true"
          style={{
            position: "fixed",
            top: menu.top,
            left: menu.left,
            width: 1,
            height: 1,
            pointerEvents: "none",
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={4}
        className="w-64 p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <Command
          value={activeCommand?.kind ?? ""}
          onValueChange={(value) => {
            const index = filtered.findIndex((item) => item.kind === value);
            if (index >= 0) setActiveIndex(index);
          }}
          shouldFilter={false}
          className="bg-transparent"
        >
          <CommandList id="slide-slash-command-list" role="listbox">
            <CommandGroup heading={t("slideSlashMenu.blocks")}>
              {filtered.map((item, index) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.kind}
                    id={`slide-slash-${item.kind}`}
                    value={item.kind}
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onPointerDown={(event) => event.preventDefault()}
                    onSelect={() => {
                      editingEl.focus({ preventScroll: true });
                      textSession?.commands.applyAuthoringCommand(
                        item.kind,
                        menu.range.cloneRange(),
                      );
                      setMenu(null);
                    }}
                    className="gap-3 px-2 py-2"
                  >
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
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
