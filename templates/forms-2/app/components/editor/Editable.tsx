import { parseMentions } from "@shared/form-model";
import {
  useContext,
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";

import { MentionLabelsContext } from "@/components/mentions/mention-labels";
import { createMentionPill } from "@/components/mentions/pill";
import { cn } from "@/lib/utils";

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node instanceof HTMLElement && node.dataset.mention)
    return node.dataset.mention;
  return [...node.childNodes].map(serializeNode).join("");
}

/** The field's text with each mention pill written back as its token. */
export function readEditableText(element: HTMLElement): string {
  return serializeNode(element);
}

/** Caret position in `readEditableText` units. */
export function caretOffset(element: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return 0;
  const range = document.createRange();
  range.selectNodeContents(element);
  const caret = selection.getRangeAt(0);
  range.setEnd(caret.endContainer, caret.endOffset);
  return serializeNode(range.cloneContents()).length;
}

/** Single-line plain-text field. The DOM owns the text while it is focused. */
export function Editable({
  id,
  value,
  label,
  placeholder,
  className,
  onChange,
  onKeyDown,
}: {
  id: string;
  value: string;
  label: string;
  placeholder: string;
  className?: string | undefined;
  onChange: (text: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const labelOf = useContext(MentionLabelsContext);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || readEditableText(element) === value) return;
    element.replaceChildren(
      ...parseMentions(value).map((segment) =>
        segment.type === "text"
          ? document.createTextNode(segment.text)
          : createMentionPill(segment.ref, labelOf(segment.ref)),
      ),
    );
  }, [value, labelOf]);

  useLayoutEffect(() => {
    ref.current
      ?.querySelectorAll<HTMLElement>("[data-mention]")
      .forEach((pill) => {
        const [segment] = parseMentions(pill.dataset.mention ?? "");
        if (segment?.type !== "mention") return;
        const label = labelOf(segment.ref);
        if (pill.textContent !== label) pill.textContent = label;
      });
  });

  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain").replace(/\s+/g, " ");
    document.execCommand("insertText", false, text);
  }

  return (
    <div
      ref={ref}
      role="textbox"
      aria-label={label}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      data-editable={id}
      data-placeholder={placeholder}
      className={cn(
        "min-h-[1.5em] cursor-text whitespace-pre-wrap break-words outline-none empty:before:pointer-events-none empty:before:text-muted-foreground/60 empty:before:content-[attr(data-placeholder)]",
        className,
      )}
      onInput={(event) => {
        const element = event.currentTarget;
        if (element.textContent === "") element.innerHTML = "";
        onChange(readEditableText(element));
      }}
      onPaste={onPaste}
      onKeyDown={onKeyDown}
    />
  );
}

export function focusEditable(id: string, at: "start" | "end" = "end") {
  const element = document.querySelector<HTMLElement>(
    `[data-editable="${CSS.escape(id)}"]`,
  );
  if (!element) return false;
  element.focus();
  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(at === "start");
    selection.removeAllRanges();
    selection.addRange(range);
  }
  return true;
}
