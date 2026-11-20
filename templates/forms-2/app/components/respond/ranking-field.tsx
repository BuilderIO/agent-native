import { useT } from "@agent-native/core/client/i18n";
import {
  isChoiceAnswer,
  moveRank,
  moveRankTo,
  toggleRank,
  type QuestionOption,
} from "@shared/form-model";
import { IconGripVertical } from "@tabler/icons-react";
import { useId, useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import type { FieldProps } from "./answer-fields";

function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

/** Display order: shuffled once per mount when the question randomizes. */
function useDisplayOrder(options: QuestionOption[], randomize: boolean) {
  return useMemo(
    () => (randomize ? shuffled(options) : options),
    [options, randomize],
  );
}

export function RankingField({
  question,
  value,
  onChange,
  invalid,
}: FieldProps) {
  const t = useT();
  const hint = useId();
  const [dragging, setDragging] = useState<string | null>(null);
  const ranked = isChoiceAnswer(value) ? value.selected : [];
  const ids = question.options.map((option) => option.id);
  const randomize =
    (question.settings.payload as { randomize?: unknown }).randomize === true;
  const order = useDisplayOrder(question.options, randomize);

  const set = (next: string[]) =>
    onChange(next.length ? { selected: next } : null);

  return (
    <div
      role="group"
      aria-label={question.title}
      aria-invalid={invalid}
      aria-describedby={[hint, invalid ? `error_${question.id}` : ""]
        .filter(Boolean)
        .join(" ")}
      className="flex flex-col items-start gap-3"
    >
      <p id={hint} className="sr-only">
        {t("forms.richBlocks.respond.rankingHint")}
      </p>
      {order.map((option) => {
        const rank = ranked.indexOf(option.id) + 1;
        return (
          <div
            key={option.id}
            draggable={rank > 0}
            onDragStart={() => setDragging(option.id)}
            onDragOver={(event) => {
              if (dragging && rank > 0) event.preventDefault();
            }}
            onDrop={() => {
              if (dragging) set(moveRankTo(ranked, dragging, option.id));
              setDragging(null);
            }}
            className="forms-input flex min-h-9 items-stretch rounded-lg border border-input bg-background text-base text-foreground shadow-sm has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-ring"
          >
            <button
              type="button"
              role="checkbox"
              aria-checked={rank > 0}
              aria-label={
                rank > 0
                  ? t("forms.richBlocks.respond.optionRanked", {
                      text: option.text,
                      rank,
                      total: ids.length,
                    })
                  : option.text
              }
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-2.5 text-left outline-none"
              onClick={() => set(toggleRank(ranked, ids, option.id))}
              onKeyDown={(event) => {
                if (rank === 0) return;
                if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  set(
                    moveRank(
                      ranked,
                      option.id,
                      event.key === "ArrowUp" ? -1 : 1,
                    ),
                  );
                }
              }}
            >
              <span
                className={cn(
                  "flex size-[18px] shrink-0 items-center justify-center rounded-[3px] text-xs font-black",
                  rank > 0
                    ? "bg-[hsl(var(--forms-keycap))] text-primary-foreground"
                    : "text-muted-foreground",
                )}
              >
                {rank > 0 ? rank : <IconGripVertical className="size-4" />}
              </span>
              <span>{option.text}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
