import { useT } from "@agent-native/core/client/i18n";
import type { QuestionRow, SubmissionRow } from "@shared/form-contract";
import { answerColumns } from "@shared/form-model";
import {
  IconCalendar,
  IconCircleHalf2,
  IconEye,
  IconTrash,
} from "@tabler/icons-react";

import { formatSubmittedAt } from "@/components/forms/submission-format";
import { UnpublishedBadge } from "@/components/forms/UnpublishedBadge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import { QuestionIcon } from "./question-icon";
import { SubmissionCell } from "./SubmissionCell";

const HEAD_CELL =
  "relative border-r border-b border-r-border border-b-border bg-background pt-[10px] pr-[50px] pb-[10px] pl-[10px] font-normal";

export function SubmissionsTable({
  rows,
  questions,
  selected,
  onToggle,
  onToggleAll,
  onOpen,
  onDelete,
}: {
  rows: SubmissionRow[];
  questions: QuestionRow[];
  selected: string[];
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (row: SubmissionRow) => void;
  onDelete: (ids: string[]) => void;
}) {
  const t = useT();
  const columns = answerColumns(questions);
  const allSelected = rows.length > 0 && selected.length === rows.length;
  const checkboxClass = cn(
    "absolute top-1/2 left-[9px] -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=checked]:opacity-100 data-[state=indeterminate]:opacity-100",
    selected.length > 0 && "opacity-100",
  );
  return (
    <div className="overflow-x-auto bg-background">
      <table className="w-max border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="group h-[45px] bg-background text-left leading-[16.1px] font-normal text-[color:var(--forms-ink-faint)]">
            <th
              aria-label={t("forms.submissions.submittedAt")}
              className={`${HEAD_CELL} min-w-[292px] pr-[99px]`}
            >
              <span className="relative flex items-center pl-8">
                <Checkbox
                  className={checkboxClass}
                  aria-label={t("forms.submissions.selectAll")}
                  checked={
                    allSelected
                      ? true
                      : selected.length > 0
                        ? "indeterminate"
                        : false
                  }
                  onCheckedChange={onToggleAll}
                />
                {selected.length > 0 ? (
                  <span className="flex items-center gap-2 text-foreground">
                    {t("forms.submissions.selectedCount", {
                      selected: selected.length,
                    })}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("forms.submissions.deleteSelected")}
                      onClick={() => onDelete(selected)}
                    >
                      <IconTrash />
                    </Button>
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <IconCalendar aria-hidden className="size-3.5" />
                    {t("forms.submissions.submittedAt")}
                  </span>
                )}
              </span>
            </th>
            {columns.map((column) => (
              <th
                key={column.key}
                className={`${HEAD_CELL} min-w-[231px]`}
                aria-labelledby={`col-${column.key}`}
                aria-describedby={
                  column.question.isDeleted
                    ? `col-${column.key}-note`
                    : undefined
                }
              >
                <div className="flex h-6 items-center gap-[5px]">
                  <QuestionIcon type={column.question.type} />
                  <span
                    id={`col-${column.key}`}
                    className="truncate overflow-hidden"
                  >
                    {column.header || t("forms.submissions.untitled")}
                  </span>
                  {column.question.isDeleted ? (
                    <UnpublishedBadge id={`col-${column.key}-note`} />
                  ) : null}
                </div>
              </th>
            ))}
            <th className="w-20 border-b border-b-border">
              <span className="sr-only">{t("forms.submissions.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="group h-[38px] border-b border-b-border bg-background leading-[16.1px]"
            >
              <td className="relative border-r border-r-border pt-[10px] pr-[99px] pb-[10px] pl-[10px]">
                <span className="relative flex items-center gap-2 pl-8 whitespace-nowrap">
                  <Checkbox
                    className={checkboxClass}
                    aria-label={t("forms.submissions.selectOne")}
                    checked={selected.includes(row.id)}
                    onCheckedChange={() => onToggle(row.id)}
                  />
                  {formatSubmittedAt(row.submittedAt)}
                  {row.isCompleted ? null : (
                    <IconCircleHalf2
                      role="img"
                      aria-label={t("forms.submissions.partialSubmission")}
                      className="size-3.5 text-muted-foreground"
                    />
                  )}
                </span>
              </td>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className="relative border-r border-r-border pt-[10px] pr-[50px] pb-[10px] pl-[10px]"
                >
                  <SubmissionCell column={column} submission={row} />
                </td>
              ))}
              <td className="px-2.5">
                <span className="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("forms.submissions.open")}
                    onClick={() => onOpen(row)}
                  >
                    <IconEye />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("forms.submissions.delete")}
                    onClick={() => onDelete([row.id])}
                  >
                    <IconTrash />
                  </Button>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
