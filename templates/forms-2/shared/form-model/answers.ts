import type {
  AnswerValue,
  Answers,
  ChoiceAnswer,
  DerivedQuestion,
  FileAnswer,
  MatrixAnswer,
} from "./types.js";

export function isChoiceAnswer(value: AnswerValue): value is ChoiceAnswer {
  return typeof value === "object" && value !== null && "selected" in value;
}

export function isMatrixAnswer(value: AnswerValue): value is MatrixAnswer {
  return typeof value === "object" && value !== null && "matrix" in value;
}

export function isFileAnswer(value: AnswerValue): value is FileAnswer {
  return typeof value === "object" && value !== null && "files" in value;
}

/**
 * The name a respondent picked for one uploaded file. Answers stored before
 * uploads recorded names fall back to the URL's last path segment.
 */
export function fileAnswerName(value: FileAnswer, index: number): string {
  const named = value.names?.[index];
  if (named?.trim()) return named;
  const url = value.files[index] ?? "";
  return decodeURIComponent(url.split("?")[0]?.split("/").pop() ?? url);
}

export function isEmptyAnswer(value: AnswerValue): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return Number.isNaN(value);
  if (isMatrixAnswer(value))
    return Object.values(value.matrix).every((ids) => ids.length === 0);
  if (isFileAnswer(value)) return value.files.length === 0;
  return value.selected.length === 0 && !value.other?.trim();
}

/** The answer as one table or CSV cell. Choice answers show option labels. */
export function answerToText(
  question: Pick<DerivedQuestion, "options" | "rows">,
  value: AnswerValue,
): string {
  if (isEmptyAnswer(value)) return "";
  if (isFileAnswer(value))
    return value.files
      .map((_, index) => fileAnswerName(value, index))
      .join(", ");
  if (isMatrixAnswer(value))
    return question.rows
      .flatMap((row) => {
        const text = matrixCellText(question, value, row.id);
        return text ? [`${row.text}: ${text}`] : [];
      })
      .join("; ");
  if (!isChoiceAnswer(value)) return String(value);
  const labels = value.selected.map((id) => {
    const option = question.options.find((candidate) => candidate.id === id);
    if (!option) return id;
    return option.isOther && value.other?.trim()
      ? `${option.text}: ${value.other.trim()}`
      : option.text;
  });
  return labels.join(", ");
}

/** Pre-filled answers from each question's default-answer setting. */
export function defaultAnswers(questions: readonly DerivedQuestion[]): Answers {
  const answers: Answers = {};
  for (const question of questions) {
    const payload = question.settings.payload as {
      hasDefaultAnswer?: unknown;
      defaultAnswer?: unknown;
    };
    if (payload.hasDefaultAnswer !== true) continue;
    const value = payload.defaultAnswer;
    if (typeof value === "string" || typeof value === "number")
      answers[question.id] = value;
  }
  return answers;
}

/** Column labels picked in one matrix row, joined by ", ". */
export function matrixCellText(
  question: Pick<DerivedQuestion, "options">,
  value: AnswerValue,
  rowId: string,
): string {
  if (!isMatrixAnswer(value)) return "";
  return (value.matrix[rowId] ?? [])
    .map(
      (id) => question.options.find((column) => column.id === id)?.text ?? id,
    )
    .join(", ");
}

type ColumnQuestion = Pick<
  DerivedQuestion,
  "id" | "title" | "options" | "rows"
> & {
  type: DerivedQuestion["type"];
};

export type AnswerColumn = {
  key: string;
  header: string;
  question: ColumnQuestion;
  /** Set on a matrix question's per-row columns. */
  rowId?: string;
};

/** One table or CSV column per question, and one per row for a matrix. */
export function answerColumns<Q extends ColumnQuestion>(
  questions: readonly Q[],
): (AnswerColumn & { question: Q })[] {
  return questions.flatMap((question) =>
    question.type === "MATRIX" && question.rows.length > 0
      ? question.rows.map((row) => ({
          key: `${question.id}:${row.id}`,
          header: `${question.title} [${row.text}]`,
          question,
          rowId: row.id,
        }))
      : [{ key: question.id, header: question.title, question }],
  );
}

/** The text of one `answerColumns` cell. */
export function columnCellText(
  column: AnswerColumn,
  value: AnswerValue,
): string {
  return column.rowId
    ? matrixCellText(column.question, value, column.rowId)
    : answerToText(column.question, value);
}
