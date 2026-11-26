import { defineActionErrors } from "@agent-native/core/action";

import {
  resolveDocumentTextEdits,
  type DocumentTextEdit,
} from "../../shared/document-text-edits.js";

export const commentAiEditErrors = defineActionErrors(
  "find_missing",
  "find_repeated",
  "finds_overlap",
  "edits_unchanged",
);

export function assertCommentAiEditsResolve(
  verification: {
    attempt: { payloadJson: string | null };
    sourceRevisionMatches: boolean;
  },
  content: string,
  edits: DocumentTextEdit[],
) {
  if (verification.attempt.payloadJson || !verification.sourceRevisionMatches) {
    return;
  }
  const retry =
    "Nothing was saved. Correct the edits and call this again with the same attemptId.";
  const resolved = resolveDocumentTextEdits(content, edits);
  if (!resolved.ok) {
    const { error } = resolved;
    if (error.kind === "missing") {
      return commentAiEditErrors.noWrite(
        `Edit ${error.editIndex + 1}'s find text is not in the latest text. Copy it exactly from quotedText or content. ${retry}`,
        "find_missing",
      );
    }
    if (error.kind === "ambiguous") {
      return commentAiEditErrors.noWrite(
        `Edit ${error.editIndex + 1}'s find text occurs ${error.matches} times in the latest text. Add nearby words until it occurs once. ${retry}`,
        "find_repeated",
      );
    }
    return commentAiEditErrors.noWrite(
      `Edits ${error.editIndexes[0] + 1} and ${error.editIndexes[1] + 1} overlap in the latest text. Combine them into one edit. ${retry}`,
      "finds_overlap",
    );
  }
  if (resolved.content === content) {
    return commentAiEditErrors.noWrite(
      `The edits together leave the text unchanged. ${retry}`,
      "edits_unchanged",
    );
  }
}
