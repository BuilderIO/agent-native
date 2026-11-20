import { isMatrixAnswer, pickMatrixCell } from "@shared/form-model";

import { cn } from "@/lib/utils";

import type { FieldProps } from "./answer-fields";

export function MatrixField({
  question,
  value,
  onChange,
  invalid,
}: FieldProps) {
  const multiple =
    (question.settings.payload as { allowMultiple?: unknown }).allowMultiple ===
    true;
  const answer = isMatrixAnswer(value) ? value : null;

  return (
    <div
      role="group"
      aria-label={question.title}
      aria-invalid={invalid}
      aria-describedby={invalid ? `error_${question.id}` : undefined}
      className="max-w-full overflow-x-auto"
    >
      <table className="border-collapse text-base">
        <thead>
          <tr>
            <td />
            {question.options.map((column) => (
              <th
                key={column.id}
                scope="col"
                className="min-w-[88px] px-2 pb-2 text-center text-sm font-medium text-muted-foreground"
              >
                {column.text}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {question.rows.map((row) => (
            <tr key={row.id} className="border-t border-border">
              <th scope="row" className="py-2 pr-4 text-left font-normal">
                {row.text}
              </th>
              {question.options.map((column) => {
                const checked = (answer?.matrix[row.id] ?? []).includes(
                  column.id,
                );
                return (
                  <td key={column.id} className="p-0 text-center">
                    <label className="relative flex h-9 cursor-pointer items-center justify-center">
                      <input
                        type={multiple ? "checkbox" : "radio"}
                        name={`${question.id}:${row.id}`}
                        aria-label={`${row.text}, ${column.text}`}
                        className="peer absolute inset-0 size-full cursor-pointer opacity-0"
                        checked={checked}
                        onChange={() =>
                          onChange(
                            pickMatrixCell(answer, row.id, column.id, multiple),
                          )
                        }
                      />
                      <span
                        className={cn(
                          "size-[18px] border border-input bg-background shadow-sm peer-checked:border-foreground peer-checked:bg-foreground peer-focus-visible:ring-1 peer-focus-visible:ring-ring",
                          multiple ? "rounded-[3px]" : "rounded-full",
                        )}
                      />
                    </label>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
