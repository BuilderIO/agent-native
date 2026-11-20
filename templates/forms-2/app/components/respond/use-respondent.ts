import { useActionMutation } from "@agent-native/core/client/hooks";
import type { FormSettings, SubmitResult } from "@shared/form-contract";
import {
  isEmptyAnswer,
  type Answers,
  type AnswerValue,
} from "@shared/form-model";
import { useMemo, useRef } from "react";

import {
  clearRespondState,
  loadAnswers,
  respondentId,
  saveAnswers,
  sessionIdFor,
} from "./respond-storage";
import { useTrackEvents } from "./track-events";

export type EventType = "start" | "page_view" | "question_answer" | "drop_off";

/** Everything the runner needs from outside: storage, events and submit. */
export type Respondent = {
  initialAnswers: () => Answers;
  persist: (answers: Answers) => void;
  event: (type: EventType, data?: Record<string, unknown>) => void;
  submit: (
    answers: Answers,
    verificationCode?: string,
  ) => Promise<SubmitResult>;
  finish: () => void;
};

const PARTIAL_DELAY_MS = 2000;

function sendable(answers: Answers) {
  const kept: Record<string, NonNullable<AnswerValue>> = {};
  for (const [id, value] of Object.entries(answers))
    if (value != null && !isEmptyAnswer(value)) kept[id] = value;
  return kept;
}

export const hasAnyAnswer = (answers: Answers) =>
  Object.values(answers).some((value: AnswerValue) => !isEmptyAnswer(value));

export const previewRespondent: Respondent = {
  initialAnswers: () => ({}),
  persist: () => undefined,
  event: () => undefined,
  submit: () =>
    Promise.resolve({ ok: true, submissionId: "preview", isCompleted: true }),
  finish: () => undefined,
};

/** The live respondent keeps one session id until a submission completes. */
export function useLiveRespondent(
  formId: string,
  settings: FormSettings,
  password?: string,
): Respondent {
  const track = useTrackEvents();
  const submitAnswers = useActionMutation("submit-response");
  const recordEvent = useActionMutation("record-form-event");
  const partial = useRef<{
    timer: number | undefined;
    inFlight: Promise<unknown> | undefined;
    restored: string | undefined;
  }>({ timer: undefined, inFlight: undefined, restored: undefined });
  const send = submitAnswers.mutateAsync;
  const record = recordEvent.mutateAsync;
  const keepAnswers = settings.saveAnswersForLater !== false;
  const keepPartials = settings.partialSubmissions === true;

  return useMemo(
    () => ({
      initialAnswers: () => {
        const loaded = keepAnswers ? loadAnswers(formId) : {};
        partial.current.restored = JSON.stringify(sendable(loaded));
        return loaded;
      },
      persist: (answers) => {
        if (keepAnswers) saveAnswers(formId, answers);
        if (!keepPartials) return;
        window.clearTimeout(partial.current.timer);
        if (!hasAnyAnswer(answers)) return;
        // Answers restored after a reload are already older than the debounce.
        const unchanged =
          JSON.stringify(sendable(answers)) === partial.current.restored;
        partial.current.timer = window.setTimeout(
          () => {
            // coercion-ok: a failed partial save is retried by the final submit.
            partial.current.inFlight = send({
              formId,
              sessionId: sessionIdFor(formId),
              respondentId: respondentId(),
              answers: sendable(answers),
              ...(password === undefined ? {} : { password }),
              isCompleted: false,
            }).catch(() => undefined);
          },
          unchanged ? 0 : PARTIAL_DELAY_MS,
        );
      },
      event: (type, data) => {
        if (!track) return;
        // coercion-ok: a lost analytics event must never block the respondent.
        record({
          formId,
          sessionId: sessionIdFor(formId),
          type,
          ...(data ? { data } : {}),
        }).catch(() => undefined);
      },
      submit: async (answers, verificationCode) => {
        window.clearTimeout(partial.current.timer);
        await partial.current.inFlight;
        return send({
          formId,
          sessionId: sessionIdFor(formId),
          respondentId: respondentId(),
          answers: sendable(answers),
          ...(password === undefined ? {} : { password }),
          isCompleted: true,
          ...(verificationCode === undefined ? {} : { verificationCode }),
        });
      },
      finish: () => clearRespondState(formId),
    }),
    [formId, keepAnswers, keepPartials, password, track, send, record],
  );
}
