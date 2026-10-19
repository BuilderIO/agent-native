import type { useT as useTranslator } from "@agent-native/core/client/i18n";
import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconBold,
  IconItalic,
  IconMinus,
  IconPlus,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import type { ElementSnapshot, SourceEdit, SourceEditOp } from "./types";

type Translate = ReturnType<typeof useTranslator>;

type InlineRangeStyle = Extract<SourceEditOp, { kind: "set-text-range-style" }>;
type InlineTextStyleKey =
  | "fontSize"
  | "fontWeight"
  | "fontStyle"
  | "color"
  | "textAlign";

function inlineTextSelectionOffsets(
  editor: HTMLElement,
): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (
    !editor.contains(range.startContainer) ||
    !editor.contains(range.endContainer)
  ) {
    return null;
  }
  const prefix = document.createRange();
  prefix.selectNodeContents(editor);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  return { start, end: start + range.toString().length };
}

type InlineTextEditorProps = {
  node: ElementSnapshot;
  disabled: boolean;
  t: Translate;
  initialPoint?: { x: number; y: number };
  onCommit: (edits: SourceEdit[]) => Promise<boolean>;
  onCancel: () => void;
};

export function InlineTextEditor({
  node,
  disabled,
  t,
  initialPoint,
  onCommit,
  onCancel,
}: InlineTextEditorProps) {
  const editableRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const [draft, setDraft] = useState(node.text);
  const [rangeStyles, setRangeStyles] = useState<InlineRangeStyle[]>([]);
  const [styleOps, setStyleOps] = useState<
    Extract<SourceEditOp, { kind: "set-style" }>[]
  >([]);
  const style = node.styles;

  useEffect(() => {
    const editor = editableRef.current;
    if (!editor) return;
    focusAndPlaceCaret(editor, node, initialPoint);
  }, [initialPoint, node, node.nodeId, node.text.length]);

  useEffect(() => {
    const editor = editableRef.current;
    if (!editor) return;
    const rememberSelection = () => {
      const selection = inlineTextSelectionOffsets(editor);
      if (selection) selectionRef.current = selection;
    };
    document.addEventListener("selectionchange", rememberSelection);
    rememberSelection();
    return () =>
      document.removeEventListener("selectionchange", rememberSelection);
  }, [node.nodeId]);

  const currentSelection = () => {
    const editor = editableRef.current;
    if (!editor) return selectionRef.current;
    const selection = inlineTextSelectionOffsets(editor);
    if (selection) selectionRef.current = selection;
    return selection ?? selectionRef.current;
  };

  const applyInlineStyle = (key: InlineTextStyleKey, value: string | null) => {
    const selection = currentSelection();
    const start = selection?.start ?? 0;
    const end = selection?.end ?? 0;
    if (key !== "textAlign" && start < end) {
      setRangeStyles((current) => [
        ...current.filter(
          (entry) =>
            !(entry.start === start && entry.end === end && entry.key === key),
        ),
        { kind: "set-text-range-style", start, end, key, value },
      ]);
    } else {
      setStyleOps((current) => [
        ...current.filter((entry) => entry.key !== key),
        { kind: "set-style", key, value },
      ]);
    }
    editableRef.current?.focus();
  };

  const selectedStyleValue = (key: InlineTextStyleKey) => {
    const selection = currentSelection();
    const start = selection?.start ?? 0;
    const end = selection?.end ?? 0;
    if (start < end) {
      const range = rangeStyles.find(
        (entry) =>
          key !== "textAlign" &&
          entry.start === start &&
          entry.end === end &&
          entry.key === key,
      );
      if (range) return range.value;
    }
    const styleOp = styleOps.find((entry) => entry.key === key);
    return styleOp ? styleOp.value : (style[key] ?? null);
  };

  const toggleInlineStyle = (key: "fontWeight" | "fontStyle") => {
    const current = selectedStyleValue(key);
    applyInlineStyle(
      key,
      key === "fontWeight"
        ? Number(current ?? "400") >= 600
          ? "400"
          : "700"
        : current === "italic"
          ? "normal"
          : "italic",
    );
  };

  const fontSize = Math.min(
    400,
    Math.max(
      4,
      Math.round(
        Number.parseFloat(selectedStyleValue("fontSize") ?? "16") || 16,
      ),
    ),
  );
  const textColor = inlineTextColor(selectedStyleValue("color") ?? undefined);
  const textAlign = selectedStyleValue("textAlign") ?? "left";

  const commit = async () => {
    if (disabled) return;
    const edits: SourceEdit[] = [];
    const textChanged = draft !== node.text;
    const firstOps: SourceEditOp[] = [
      ...(textChanged
        ? [{ kind: "set-text" as const, value: draft, prevText: node.text }]
        : []),
      ...styleOps,
    ];
    if (firstOps.length)
      edits.push({ line: node.line, column: node.column, ops: firstOps });
    if (rangeStyles.length) {
      edits.push({
        line: node.line,
        column: node.column,
        ...(firstOps.length ? { dependsOn: edits.length - 1 } : {}),
        ops: rangeStyles.map((entry) => ({ ...entry, prevText: draft })),
      });
    }
    if (await onCommit(edits)) onCancel();
  };

  const insertPlainText = (text: string) => {
    const editor = editableRef.current;
    if (!editor) return;
    const currentText = editor.textContent ?? "";
    const selection = currentSelection();
    const start = selection?.start ?? currentText.length;
    const end = selection?.end ?? currentText.length;
    const nextText = `${currentText.slice(0, start)}${text}${currentText.slice(end)}`;
    editor.textContent = nextText;
    setDraft(nextText);

    const caret = start + text.length;
    const range = document.createRange();
    const textNode = editor.firstChild;
    if (textNode?.nodeType === 3) {
      range.setStart(
        textNode,
        Math.min(caret, textNode.textContent?.length ?? 0),
      );
    } else {
      range.selectNodeContents(editor);
    }
    range.collapse(true);
    const browserSelection = window.getSelection();
    browserSelection?.removeAllRanges();
    browserSelection?.addRange(range);
  };

  return (
    <>
      <div
        className="pointer-events-auto absolute z-10"
        style={{
          left: Math.max(0, Math.min(node.bounds.x, 1920 - 720)),
          top: Math.max(0, node.bounds.y - 44),
          maxWidth: 720,
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-1 rounded-md border border-border bg-background p-1 shadow-md">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            title={t("styleInspector.decreaseSize")}
            aria-label={t("styleInspector.decreaseSize")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() =>
              applyInlineStyle("fontSize", `${Math.max(4, fontSize - 1)}px`)
            }
          >
            <IconMinus className="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            title={t("styleInspector.increaseSize")}
            aria-label={t("styleInspector.increaseSize")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() =>
              applyInlineStyle("fontSize", `${Math.min(400, fontSize + 1)}px`)
            }
          >
            <IconPlus className="size-4" aria-hidden="true" />
          </Button>
          <span className="min-w-8 text-center text-xs tabular-nums text-muted-foreground">
            {fontSize}
          </span>
          <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={t("slideTextMenu.bold")}
            title={t("slideTextMenu.bold")}
            aria-pressed={
              Number(selectedStyleValue("fontWeight") ?? "400") >= 600
            }
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => toggleInlineStyle("fontWeight")}
          >
            <IconBold className="size-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={t("styleInspector.italic")}
            title={t("styleInspector.italic")}
            aria-pressed={selectedStyleValue("fontStyle") === "italic"}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => toggleInlineStyle("fontStyle")}
          >
            <IconItalic className="size-4" aria-hidden="true" />
          </Button>
          <label
            className="relative inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-accent focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background"
            aria-label={t("styleInspector.textColor")}
            title={t("styleInspector.textColor")}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <span
              className="size-4 rounded-sm border border-foreground/15"
              style={{ backgroundColor: textColor }}
            />
            <input
              type="color"
              value={textColor}
              disabled={disabled}
              onChange={(event) =>
                applyInlineStyle("color", event.currentTarget.value)
              }
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
          </label>
          <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
          {(
            [
              ["left", IconAlignLeft, "textAlignLeft"],
              ["center", IconAlignCenter, "textAlignCenter"],
              ["right", IconAlignRight, "textAlignRight"],
            ] as const
          ).map(([alignment, Icon, labelKey]) => (
            <Button
              key={alignment}
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label={t(`styleInspector.${labelKey}`)}
              aria-pressed={textAlign === alignment}
              title={t(`styleInspector.${labelKey}`)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                applyInlineStyle(
                  "textAlign",
                  alignment === "left" ? null : alignment,
                )
              }
            >
              <Icon className="size-4" aria-hidden="true" />
            </Button>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            aria-label={t("designSystemSetup.saveChanges")}
            onClick={() => void commit()}
          >
            {t("designSystemSetup.saveChanges")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={onCancel}
          >
            {t("slideTextMenu.cancel")}
          </Button>
        </div>
      </div>
      <div
        ref={editableRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={t("styleInspector.text")}
        spellCheck={false}
        onInput={(event) => setDraft(event.currentTarget.textContent ?? "")}
        onCompositionEnd={(event) =>
          setDraft(event.currentTarget.textContent ?? "")
        }
        onPaste={(event) => {
          event.preventDefault();
          insertPlainText(event.clipboardData.getData("text/plain"));
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229
          )
            return;
          if (event.key === "Escape") {
            event.preventDefault();
            void commit();
          } else if (
            event.key === "Enter" &&
            (event.metaKey || event.ctrlKey)
          ) {
            event.preventDefault();
            void commit();
          } else if (event.key === "Enter") {
            event.preventDefault();
            insertPlainText("\n");
          } else if (
            (event.metaKey || event.ctrlKey) &&
            !event.altKey &&
            event.key.toLowerCase() === "b"
          ) {
            event.preventDefault();
            toggleInlineStyle("fontWeight");
          } else if (
            (event.metaKey || event.ctrlKey) &&
            !event.altKey &&
            event.key.toLowerCase() === "i"
          ) {
            event.preventDefault();
            toggleInlineStyle("fontStyle");
          }
        }}
        className="pointer-events-auto absolute z-10 min-h-10 whitespace-pre-wrap break-words border-2 border-primary bg-background/95 p-1 text-foreground shadow-sm focus-visible:ring-2 focus-visible:ring-primary"
        style={{
          left: node.bounds.x,
          top: node.bounds.y,
          width: Math.max(96, node.bounds.width),
          height: Math.max(40, node.bounds.height),
          fontFamily: style.fontFamily || undefined,
          fontSize: style.fontSize || undefined,
          fontWeight: style.fontWeight || undefined,
          fontStyle: style.fontStyle || undefined,
          lineHeight: style.lineHeight || undefined,
          letterSpacing: style.letterSpacing || undefined,
          textAlign:
            (style.textAlign as "left" | "center" | "right" | undefined) ||
            undefined,
          color: style.color || undefined,
        }}
      >
        {draft}
      </div>
    </>
  );
}

function focusAndPlaceCaret(
  editor: HTMLElement,
  node: ElementSnapshot,
  slidePoint?: { x: number; y: number },
) {
  editor.focus();
  const selection = window.getSelection();
  if (!selection) return;

  if (slidePoint) {
    const rect = editor.getBoundingClientRect();
    const x =
      rect.left +
      ((slidePoint.x - node.bounds.x) / Math.max(node.bounds.width, 1)) *
        rect.width;
    const y =
      rect.top +
      ((slidePoint.y - node.bounds.y) / Math.max(node.bounds.height, 1)) *
        rect.height;
    const range = caretRangeAtPoint(x, y);
    if (range && editor.contains(range.startContainer)) {
      selection.removeAllRanges();
      selection.addRange(range);
      const modifiable = selection as Selection & {
        modify?: (
          alter: string,
          direction: string,
          granularity: string,
        ) => void;
      };
      if (
        typeof modifiable.modify === "function" &&
        range.startContainer instanceof Text
      ) {
        modifiable.modify("move", "backward", "word");
        modifiable.modify("extend", "forward", "word");
      }
      return;
    }
  }

  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function caretRangeAtPoint(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };
  if (typeof doc.caretRangeFromPoint === "function")
    return doc.caretRangeFromPoint(x, y);
  const position = doc.caretPositionFromPoint?.(x, y);
  if (!position) return null;
  const range = document.createRange();
  try {
    range.setStart(position.offsetNode, position.offset);
  } catch {
    return null;
  }
  range.collapse(true);
  return range;
}

function inlineTextColor(value: string | undefined): string {
  if (value && /^#[\da-f]{6}$/i.test(value)) return value;
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value ?? "");
  if (!rgb) return "#000000";
  return `#${rgb
    .slice(1, 4)
    .map((channel) =>
      Math.max(0, Math.min(255, Number(channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
