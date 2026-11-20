import { useT } from "@agent-native/core/client/i18n";
import type { QuestionRow, SubmissionRow } from "@shared/form-contract";
import {
  columnCellText,
  fileAnswerName,
  isFileAnswer,
  safeMediaUrl,
  type AnswerColumn,
  type AnswerValue,
} from "@shared/form-model";
import { IconStarFilled } from "@tabler/icons-react";

/** Uploaded files as links and a signature as its image; null for other answers. */
export function MediaAnswer({
  question,
  answer,
  size,
}: {
  question: Pick<QuestionRow, "type">;
  answer: AnswerValue;
  size: "cell" | "detail";
}) {
  const t = useT();
  if (question.type === "SIGNATURE" && typeof answer === "string") {
    const src = safeMediaUrl(answer);
    return src ? (
      <img
        src={src}
        alt={t("forms.richBlocks.signatureAnswer")}
        className={size === "cell" ? "h-8 max-w-[160px]" : "h-24 max-w-full"}
      />
    ) : null;
  }
  if (question.type === "FILE_UPLOAD" && isFileAnswer(answer))
    return (
      <span className="flex flex-col gap-1">
        {answer.files.map((url, index) => {
          const href = safeMediaUrl(url);
          return href ? (
            <a
              key={url}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="block max-w-[200px] truncate underline"
            >
              {fileAnswerName(answer, index)}
            </a>
          ) : null;
        })}
      </span>
    );
  return null;
}

/** The content of one table cell; the `td` around it is the cell role. */
export function SubmissionCell({
  column,
  submission,
}: {
  column: AnswerColumn & { question: QuestionRow };
  submission: SubmissionRow;
}) {
  const t = useT();
  const { question } = column;
  const answer = submission.answers[question.id];
  const text = columnCellText(column, answer);
  if (!text) return "-";
  if (question.type === "SIGNATURE" || question.type === "FILE_UPLOAD")
    return <MediaAnswer question={question} answer={answer} size="cell" />;
  if (question.type === "RATING" && typeof answer === "number")
    return (
      <span
        role="img"
        className="flex"
        aria-label={t("forms.submissions.stars", { count: answer })}
      >
        {Array.from({ length: answer }, (_, index) => (
          <IconStarFilled
            key={index}
            className="block size-3.5 text-[hsl(var(--forms-star))]"
          />
        ))}
      </span>
    );
  return <span className="block max-w-[200px] truncate">{text}</span>;
}
