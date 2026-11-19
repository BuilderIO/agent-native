import { useT } from "@agent-native/core/client/i18n";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import {
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconTextWrap,
} from "@tabler/icons-react";
import type { Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  CODE_BLOCK_LANGUAGES,
  PLAIN_TEXT_CODE_LANGUAGE,
  codeBlockLanguageChoice,
} from "./extensions/CodeBlockNode";
import { LOCAL_FILE_USER_EDIT_META } from "./extensions/LocalMdxComponentNode";

interface CodeBlockToolbarProps {
  editor: Editor;
  canEdit: boolean;
}

const COPIED_MS = 1500;

const CODE_BLOCK_SELECTOR = "pre.content-code-block";

function getMountedEditorView(editor: Editor): EditorView | null {
  if (editor.isDestroyed) return null;
  try {
    const view = editor.view;
    return view.dom.isConnected ? view : null;
  } catch {
    // coercion-ok: an editor whose view isn't mounted has no view to read.
    return null;
  }
}

function getTargetElement(target: EventTarget | null) {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function plainCodeBlockAt(view: EditorView, pos: number | null) {
  if (pos === null) return null;
  const node = view.state.doc.nodeAt(pos);
  if (node?.type.name !== "codeBlock") return null;
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement) || !dom.matches(CODE_BLOCK_SELECTOR))
    return null;
  return { node, dom };
}

function codeBlockPosOf(view: EditorView, pre: Element): number | null {
  try {
    const $inside = view.state.doc.resolve(view.posAtDOM(pre, 0));
    for (let depth = $inside.depth; depth > 0; depth--) {
      if ($inside.node(depth).type.name === "codeBlock")
        return $inside.before(depth);
    }
  } catch {
    // coercion-ok: a node the view is still drawing has no position yet.
  }
  return null;
}

function hoveredCodeBlockPos(view: EditorView, target: EventTarget | null) {
  const pre = getTargetElement(target)?.closest(CODE_BLOCK_SELECTOR);
  if (!pre || pre.closest(".ProseMirror") !== view.dom) return null;
  return codeBlockPosOf(view, pre);
}

function selectedCodeBlockPos(view: EditorView): number | null {
  if (!view.hasFocus()) return null;
  const { $from, $to } = view.state.selection;
  if ($from.parent.type.name !== "codeBlock" || !$from.sameParent($to))
    return null;
  return $from.before();
}

function remapCodeBlockPos(transaction: Transaction, pos: number | null) {
  if (pos === null) return null;
  const { mapping, doc } = transaction;
  const start = mapping.mapResult(pos);
  if (start.deletedAfter && mapping.mapResult(pos + 1).deleted) return null;
  return doc.nodeAt(start.pos)?.type.name === "codeBlock" ? start.pos : null;
}

export function CodeBlockToolbar({ editor, canEdit }: CodeBlockToolbarProps) {
  const t = useT();
  const [hoveredPos, setHoveredPos] = useState<number | null>(null);
  const [menuPos, setMenuPos] = useState<number | null>(null);
  const [copiedPos, setCopiedPos] = useState<number | null>(null);
  const [, setRevision] = useState(0);
  const [viewRetry, setViewRetry] = useState(0);
  const refocusEditorOnCloseRef = useRef(false);

  useEffect(() => {
    if (editor.isDestroyed) return;
    const view = getMountedEditorView(editor);
    if (!view) {
      if (viewRetry >= 5) return;
      const frame = requestAnimationFrame(() => {
        setViewRetry((retry) => (retry >= 5 ? retry : retry + 1));
      });
      return () => cancelAnimationFrame(frame);
    }

    const rerender = () => setRevision((revision) => revision + 1);
    const isBarTarget = (target: EventTarget | null) =>
      Boolean(getTargetElement(target)?.closest("[data-code-block-toolbar]"));
    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch" || isBarTarget(event.target)) return;
      setHoveredPos(hoveredCodeBlockPos(view, event.target));
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || isBarTarget(event.target)) return;
      setHoveredPos(hoveredCodeBlockPos(view, event.target));
    };
    const handlePointerOut = (event: PointerEvent) => {
      if (!event.relatedTarget) setHoveredPos(null);
    };
    const handleTransaction = ({
      transaction,
    }: {
      transaction: Transaction;
    }) => {
      if (transaction.docChanged) {
        setHoveredPos((pos) => remapCodeBlockPos(transaction, pos));
        setMenuPos((pos) => remapCodeBlockPos(transaction, pos));
        setCopiedPos((pos) => remapCodeBlockPos(transaction, pos));
      }
      rerender();
    };
    const resizeObserver = new ResizeObserver(rerender);

    resizeObserver.observe(view.dom);
    editor.on("transaction", handleTransaction);
    editor.on("focus", rerender);
    editor.on("blur", rerender);
    editor.on("destroy", rerender);
    document.addEventListener("pointermove", handlePointerMove, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("pointerout", handlePointerOut, true);
    window.addEventListener("resize", rerender);
    window.addEventListener("scroll", rerender, true);

    return () => {
      resizeObserver.disconnect();
      editor.off("transaction", handleTransaction);
      editor.off("focus", rerender);
      editor.off("blur", rerender);
      editor.off("destroy", rerender);
      document.removeEventListener("pointermove", handlePointerMove, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("pointerout", handlePointerOut, true);
      window.removeEventListener("resize", rerender);
      window.removeEventListener("scroll", rerender, true);
    };
  }, [editor, viewRetry]);

  useEffect(() => {
    if (copiedPos === null) return;
    const timer = window.setTimeout(() => setCopiedPos(null), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copiedPos]);

  const view = getMountedEditorView(editor);
  if (!view) return null;
  const editable = canEdit && editor.isEditable;
  const pos =
    menuPos ?? hoveredPos ?? (editable ? selectedCodeBlockPos(view) : null);
  const block = plainCodeBlockAt(view, pos);
  const wrapper = view.dom.closest(".visual-editor-wrapper");
  if (pos === null || !block || !wrapper) return null;

  const wrapperRect = wrapper.getBoundingClientRect();
  const blockRect = block.dom.getBoundingClientRect();
  const choice = codeBlockLanguageChoice(block.node.attrs.language);
  const choices = [
    { value: null, label: t("editor.codeLanguageAuto") },
    { value: PLAIN_TEXT_CODE_LANGUAGE, label: t("editor.plainText") },
    ...CODE_BLOCK_LANGUAGES,
  ];
  const chosen = choices.find((option) => option.value === choice);
  const languageLabel = chosen?.label ?? String(block.node.attrs.language);
  const wraps = block.node.attrs.wrap === true;
  const copied = copiedPos === pos;

  const updateBlock = (attrs: Record<string, unknown>) => {
    const liveView = getMountedEditorView(editor);
    if (!liveView) return;
    const current = plainCodeBlockAt(liveView, pos);
    if (!current) return;
    liveView.dispatch(
      liveView.state.tr
        .setNodeMarkup(pos, undefined, { ...current.node.attrs, ...attrs })
        .setMeta(LOCAL_FILE_USER_EDIT_META, true),
    );
  };

  const copy = async () => {
    if (await writeClipboardText(block.node.textContent)) setCopiedPos(pos);
    else toast.error(t("editor.toolbar.clipboardAccessUnavailable"));
  };

  return (
    <div
      className="content-code-block-bar"
      contentEditable={false}
      data-code-block-toolbar=""
      style={
        {
          "--code-block-bar-left": `${blockRect.left - wrapperRect.left}px`,
          "--code-block-bar-top": `${blockRect.top - wrapperRect.top}px`,
          "--code-block-bar-width": `${blockRect.width}px`,
        } as CSSProperties
      }
      onMouseDown={(event) => event.preventDefault()}
    >
      {editable ? (
        <Popover
          open={menuPos !== null}
          onOpenChange={(open) => {
            if (open) refocusEditorOnCloseRef.current = view.hasFocus();
            setMenuPos(open ? pos : null);
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              className="content-code-lang-btn"
              aria-label={t("editor.codeLanguage")}
            >
              {languageLabel}
              <IconChevronDown className="size-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-52 p-0"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (refocusEditorOnCloseRef.current) view.focus();
            }}
          >
            <Command>
              <CommandInput
                placeholder={t("editor.searchLanguages")}
                aria-label={t("editor.codeLanguage")}
              />
              <CommandList className="max-h-64">
                <CommandEmpty>{t("editor.noLanguagesFound")}</CommandEmpty>
                <CommandGroup>
                  {choices.map((option) => (
                    <CommandItem
                      key={option.value ?? "auto"}
                      value={option.label}
                      keywords={option.value ? [option.value] : []}
                      onSelect={() => {
                        updateBlock({ language: option.value });
                        setMenuPos(null);
                      }}
                    >
                      {option.label}
                      {option.value === choice ? (
                        <IconCheck className="ms-auto size-3.5" />
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) : choice ? (
        <span className="content-code-lang-btn content-code-lang-btn--readonly">
          {languageLabel}
        </span>
      ) : null}
      <div className="content-code-block-bar__actions">
        {editable ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  "content-code-lang-btn content-code-lang-btn--icon",
                  wraps && "content-code-lang-btn--active",
                )}
                aria-label={t("editor.wrapCodeLines")}
                aria-pressed={wraps}
                onClick={() => updateBlock({ wrap: !wraps })}
              >
                <IconTextWrap className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("editor.wrapCodeLines")}</TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip {...(copied ? { open: true } : {})}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="content-code-lang-btn content-code-lang-btn--icon"
              aria-label={
                copied ? t("editor.codeCopied") : t("editor.copyCode")
              }
              onClick={() => void copy()}
            >
              {copied ? (
                <IconCheck className="size-3.5" />
              ) : (
                <IconCopy className="size-3.5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {copied ? t("editor.codeCopied") : t("editor.copyCode")}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
