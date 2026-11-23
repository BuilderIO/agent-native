import { useT } from "@agent-native/core/client/i18n";
import { useState } from "react";
import { z } from "zod";

import { InputCellControl } from "@/components/notebook/InputCellControl";
import { Input } from "@/components/ui/input";
import type { Cell } from "@/lib/model/contracts";

import type getNotebookInputChoices from "../../../actions/get-notebook-input-choices";
import { rangePresetUpdates } from "../../../shared/input-range";

export type InputUpdate = {
  cell: Cell;
  value: string;
  optionsResultId?: string;
};

export function PublishedInputControl({
  cell,
  range,
  values,
  choices,
  onChange,
  onCommit,
  onCommitValues,
}: {
  cell: Cell;
  range: { start: Cell; end: Cell } | null;
  values: Record<string, string>;
  choices: Awaited<ReturnType<typeof getNotebookInputChoices.run>> | undefined;
  onChange: ((cell: Cell, value: string) => void) | undefined;
  onCommit:
    | ((cell: Cell, value: string, optionsResultId?: string) => void)
    | undefined;
  onCommitValues: ((updates: InputUpdate[]) => void) | undefined;
}) {
  const t = useT();
  const [draft, setDraft] = useState<{
    start: string;
    end: string;
    baseStart: string;
    baseEnd: string;
  } | null>(null);
  const savedStart =
    range &&
    (values[range.start.id] ??
      (range.start.contents.kind === "input"
        ? range.start.contents.defaultValueString
        : ""));
  const savedEnd =
    range &&
    (values[range.end.id] ??
      (range.end.contents.kind === "input"
        ? range.end.contents.defaultValueString
        : ""));
  const activeDraft =
    draft?.baseStart === savedStart && draft?.baseEnd === savedEnd
      ? draft
      : null;
  const contents = cell.contents;
  if (contents.kind !== "input") return null;
  const value = values[cell.id] ?? contents.defaultValueString;
  const start = activeDraft?.start ?? savedStart ?? "";
  const end = activeDraft?.end ?? savedEnd ?? "";
  const valid =
    z.iso.date().safeParse(start).success &&
    z.iso.date().safeParse(end).success &&
    start <= end;
  function edit(next: { start: string; end: string }) {
    setDraft({ ...next, baseStart: savedStart ?? "", baseEnd: savedEnd ?? "" });
    if (
      range &&
      z.iso.date().safeParse(next.start).success &&
      z.iso.date().safeParse(next.end).success &&
      next.start <= next.end
    )
      onCommitValues?.([
        { cell: range.start, value: next.start },
        { cell: range.end, value: next.end },
      ]);
  }
  const custom = value === "custom" && contents.rangeInputs !== undefined;
  const control = (
    <InputCellControl
      contents={{ ...contents, name: contents.label ?? contents.name }}
      value={value}
      disabled={onCommit === undefined}
      verifiedChoices={choices}
      onChange={(next) => {
        setDraft(null);
        onChange?.(cell, next);
      }}
      onCommit={(next, optionsResultId) => {
        if (range && onCommitValues && contents.rangeInputs?.initialDays)
          onCommitValues(rangePresetUpdates(cell, range, next, values));
        else onCommit?.(cell, next, optionsResultId);
      }}
    />
  );
  if (!custom) return control;
  return (
    <div className="grid gap-2 [&>.nb-input-cell]:p-0">
      {control}
      {custom &&
        (range ? (
          <div
            role="group"
            aria-label={contents.label ?? contents.name}
            className="flex flex-wrap items-end gap-2"
          >
            <label className="grid gap-1 text-xs">
              {t("publishedApp.rangeStart")}
              <Input
                type="date"
                size="sm"
                aria-label={t("publishedApp.rangeStart")}
                value={start}
                disabled={!onCommitValues}
                onChange={(event) =>
                  edit({ start: event.currentTarget.value, end })
                }
              />
            </label>
            <label className="grid gap-1 text-xs">
              {t("publishedApp.rangeEnd")}
              <Input
                type="date"
                size="sm"
                aria-label={t("publishedApp.rangeEnd")}
                value={end}
                disabled={!onCommitValues}
                onChange={(event) =>
                  edit({ start, end: event.currentTarget.value })
                }
              />
            </label>
            {!valid && (
              <p
                role="status"
                className="basis-full text-xs text-muted-foreground"
              >
                {t("publishedApp.rangeInvalid")}
              </p>
            )}
          </div>
        ) : (
          <p role="alert">{t("publishedApp.rangeUnavailable")}</p>
        ))}
    </div>
  );
}
