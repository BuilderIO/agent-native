import { useT } from "@agent-native/core/client/i18n";
import type { QuestionRow, SubmissionRow } from "@shared/form-contract";
import { answerToText } from "@shared/form-model";

import { formatSubmittedAt } from "@/components/forms/submission-format";
import { UnpublishedBadge } from "@/components/forms/UnpublishedBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { MediaAnswer } from "./SubmissionCell";

export function SubmissionModal({
  submission,
  questions,
  onClose,
}: {
  submission: SubmissionRow | null;
  questions: QuestionRow[];
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Dialog
      open={submission !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("forms.submissions.submission")}</DialogTitle>
          <DialogDescription>
            {submission
              ? `${formatSubmittedAt(submission.submittedAt)}${submission.isCompleted ? "" : ` · ${t("forms.submissions.partial")}`}`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          {submission
            ? questions.map((question) => (
                <div key={question.id}>
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {question.title || t("forms.submissions.untitled")}
                    {question.isDeleted ? <UnpublishedBadge /> : null}
                  </div>
                  <div className="mt-1 text-base">
                    {question.type === "SIGNATURE" ||
                    question.type === "FILE_UPLOAD" ? (
                      <MediaAnswer
                        question={question}
                        answer={submission.answers[question.id]}
                        size="detail"
                      />
                    ) : (
                      answerToText(question, submission.answers[question.id]) ||
                      "-"
                    )}
                  </div>
                </div>
              ))
            : null}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">{t("forms.submissions.close")}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
