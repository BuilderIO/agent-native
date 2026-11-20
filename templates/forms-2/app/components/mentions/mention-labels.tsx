import { useT } from "@agent-native/core/client/i18n";
import {
  deriveQuestions,
  type Block,
  type MentionMetaField,
  type MentionRef,
} from "@shared/form-model";
import { createContext, useCallback, type ReactNode } from "react";

export type MentionLabeler = (ref: MentionRef) => string;

export const MentionLabelsContext = createContext<MentionLabeler>((ref) =>
  ref.kind === "answer" ? ref.questionId : ref.field,
);

export const META_LABEL_KEYS: Record<MentionMetaField, string> = {
  "submission-id": "forms.mentions.submissionId",
  "respondent-id": "forms.mentions.respondentId",
  "form-name": "forms.mentions.formName",
};

/** Names pills in the editor: a question's current title, or the metadata label. */
export function MentionLabelsProvider({
  blocks,
  children,
}: {
  blocks: readonly Block[];
  children: ReactNode;
}) {
  const t = useT();
  const labelOf = useCallback<MentionLabeler>(
    (ref) => {
      if (ref.kind === "meta") return t(META_LABEL_KEYS[ref.field]);
      const question = deriveQuestions(blocks).find(
        (candidate) => candidate.id === ref.questionId,
      );
      return question?.title || t("forms.mentions.untitledQuestion");
    },
    [blocks, t],
  );
  return (
    <MentionLabelsContext.Provider value={labelOf}>
      {children}
    </MentionLabelsContext.Provider>
  );
}
