import { useT } from "@agent-native/core/client/i18n";
import {
  deriveQuestions,
  MENTION_META_FIELDS,
  type Block,
  type MentionRef,
} from "@shared/form-model";
import { IconAt, IconHash } from "@tabler/icons-react";
import { useCallback, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import { MentionLabelsContext, META_LABEL_KEYS } from "./mention-labels";
import { createMentionPill } from "./pill";

type Option = { ref: MentionRef; label: string };

type Trigger = {
  editable: HTMLElement;
  node: Text;
  /** Caret offset in `node`, just after the typed filter. */
  end: number;
  filter: string;
  x: number;
  y: number;
};

const TRIGGER = /(^|\s)@([^@]{0,40})$/;
const MENTIONABLE: Block["type"][] = [
  "TEXT",
  "TITLE",
  "HEADING_1",
  "HEADING_2",
  "HEADING_3",
];

function findTrigger(
  blocks: readonly Block[],
): { trigger: Trigger; block: Block } | null {
  const selection = window.getSelection();
  const node = selection?.anchorNode;
  if (!selection?.isCollapsed || node?.nodeType !== Node.TEXT_NODE) return null;
  const editable = node.parentElement?.closest<HTMLElement>("[data-editable]");
  const block = blocks.find(
    (candidate) => candidate.uuid === editable?.dataset.editable,
  );
  if (!editable || !block || !MENTIONABLE.includes(block.type)) return null;
  const end = selection.anchorOffset;
  const match = TRIGGER.exec((node.textContent ?? "").slice(0, end));
  if (!match) return null;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  const box = rect.height > 0 ? rect : editable.getBoundingClientRect();
  return {
    block,
    trigger: {
      editable,
      node: node as Text,
      end,
      filter: match[2] ?? "",
      x: box.left,
      y: box.bottom,
    },
  };
}

/** `@` in a text block or question title: pick an earlier answer or a metadata value. */
export function MentionMenu({
  latest,
}: {
  latest: { current: readonly Block[] };
}) {
  const t = useT();
  const labelOf = useContext(MentionLabelsContext);
  const [state, setState] = useState<{
    trigger: Trigger;
    block: Block;
  } | null>(null);
  const [active, setActive] = useState(0);

  const optionsFor = useCallback(
    (block: Block, filter: string): Option[] => {
      const blocks = latest.current;
      const at = blocks.indexOf(block);
      const earlier: Option[] = deriveQuestions(blocks)
        .filter(
          (question) =>
            question.title !== "" &&
            blocks.findIndex((b) => b.groupUuid === question.id) < at,
        )
        .map((question) => {
          const ref: MentionRef = { kind: "answer", questionId: question.id };
          return { ref, label: question.title };
        });
      const meta = MENTION_META_FIELDS.map((field): Option => {
        const ref: MentionRef = { kind: "meta", field };
        return { ref, label: t(META_LABEL_KEYS[field]) };
      });
      const needle = filter.trim().toLowerCase();
      return [...earlier, ...meta].filter((option) =>
        option.label.toLowerCase().includes(needle),
      );
    },
    [latest, t],
  );

  const options = state ? optionsFor(state.block, state.trigger.filter) : [];
  const open = state !== null && options.length > 0;

  const pick = useCallback(
    (option: Option) => {
      if (!state) return;
      const { editable, node, end, filter } = state.trigger;
      const range = document.createRange();
      range.setStart(node, end - filter.length - 1);
      range.setEnd(node, end);
      range.deleteContents();
      const pill = createMentionPill(option.ref, labelOf(option.ref));
      const space = document.createTextNode(" ");
      range.insertNode(pill);
      pill.after(space);
      const caret = document.createRange();
      caret.setStart(space, 1);
      caret.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(caret);
      setState(null);
      editable.dispatchEvent(new Event("input", { bubbles: true }));
    },
    [state, labelOf],
  );

  useEffect(() => {
    function onInput() {
      setState(findTrigger(latest.current));
      setActive(0);
    }
    function onBlur() {
      setState(null);
    }
    document.addEventListener("input", onInput);
    document.addEventListener("focusout", onBlur);
    return () => {
      document.removeEventListener("input", onInput);
      document.removeEventListener("focusout", onBlur);
    };
  }, [latest]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      const move = (delta: number) => {
        event.preventDefault();
        event.stopPropagation();
        setActive((index) => (index + delta + options.length) % options.length);
      };
      if (event.key === "ArrowDown") move(1);
      else if (event.key === "ArrowUp") move(-1);
      else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        const chosen = options[active];
        if (chosen) pick(chosen);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setState(null);
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, options, active, pick]);

  if (!open) return null;
  const answers = options.filter((option) => option.ref.kind === "answer");
  return createPortal(
    <div
      role="listbox"
      aria-label={t("forms.mentions.menuLabel")}
      className="fixed z-50 max-h-64 w-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-md"
      style={{ left: state.trigger.x, top: state.trigger.y + 6 }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {options.map((option, index) => {
        const Icon = option.ref.kind === "answer" ? IconAt : IconHash;
        return (
          <div
            key={`${option.ref.kind}:${option.label}:${index}`}
            role="option"
            aria-selected={index === active}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5",
              index === active && "bg-accent",
              index === answers.length && answers.length > 0
                ? "mt-1 border-t border-border pt-2"
                : "",
            )}
            onMouseEnter={() => setActive(index)}
            onClick={() => pick(option)}
          >
            <Icon
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span className="truncate">{option.label}</span>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
