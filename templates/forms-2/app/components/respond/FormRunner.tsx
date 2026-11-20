import { useT } from "@agent-native/core/client/i18n";
import type { FormSettings } from "@shared/form-contract";
import {
  answerToText,
  blockText,
  buttonFor,
  calculateFields,
  currentPage,
  defaultAnswers,
  deriveQuestions,
  evaluatePage,
  formTitleOf,
  hiddenFieldAnswers,
  hiddenFieldsOf,
  initialStack,
  isEmptyAnswer,
  pageAt,
  popPage,
  pushPage,
  questionTypeOfBlock,
  resolveMentions,
  resolveNextStep,
  splitPages,
  thankYouPage,
  validatePage,
  type Answers,
  type AnswerValue,
  type Block,
  type DerivedQuestion,
  type Page,
  type PageStack,
  type PageState,
  type ValidationError,
} from "@shared/form-model";
import { IconArrowRight, IconLoader2 } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MediaBlock } from "@/components/forms/MediaBlock";
import {
  MentionValuesContext,
  useResolveMentions,
} from "@/components/mentions/mention-values";
import { Button } from "@/components/ui/button";

import { QuestionField } from "./answer-fields";
import { respondentId } from "./respond-storage";
import { ClosedState, DuplicateState, Frame, UnavailableState } from "./states";
import { ThemedSurface } from "./ThemedSurface";
import { previewRespondent, useLiveRespondent } from "./use-respondent";
import { validationMessage } from "./validation-message";
import {
  VerifyEmailStep,
  type VerifyReason,
  type VerifyState,
} from "./VerifyEmailStep";

/**
 * Renders a block list as the respondent sees it.
 * - `live`: the public form. Answers are kept in the browser, events are
 *   recorded and Submit calls `submit-response` with `formId`.
 * - `preview`: the editor's Preview. No storage and no network; Submit just
 *   shows the thank-you page. Pass the editor's current blocks and settings.
 */
export type FormRunnerProps =
  | {
      mode: "live";
      formId: string;
      blocks: readonly Block[];
      settings: FormSettings;
      /** Sent with every save when the form is password protected. */
      password?: string;
    }
  | { mode: "preview"; blocks: readonly Block[]; settings?: FormSettings };

type Phase =
  | "filling"
  | "submitting"
  | "done"
  | "closed"
  | "unavailable"
  | "duplicate";

const FIELD_SELECTOR =
  "input:not([type=hidden]), textarea, button[role=combobox]";

function StaticBlock({ block }: { block: Block }) {
  const text = useResolveMentions()(blockText(block));
  switch (block.type) {
    case "FORM_TITLE":
      return (
        <div className="py-px">
          <h1 className="forms-title pb-[40px] text-[40px] leading-[48px] font-extrabold">
            {text}
          </h1>
        </div>
      );
    case "TEXT":
      return <p className="py-2 text-base leading-6">{text}</p>;
    case "HEADING_1":
      return <h2 className="py-2 text-3xl font-bold">{text}</h2>;
    case "HEADING_2":
      return <h2 className="py-2 text-2xl font-bold">{text}</h2>;
    case "HEADING_3":
      return <h3 className="py-2 text-xl font-semibold">{text}</h3>;
    case "DIVIDER":
      return <hr className="my-4 border-border" />;
    case "TITLE":
      return <h3 className="py-2 text-xl font-semibold">{text}</h3>;
    case "PAGE_BREAK":
    case "THANK_YOU_PAGE":
    case "INPUT_TEXT":
    case "TEXTAREA":
    case "INPUT_EMAIL":
    case "INPUT_NUMBER":
    case "INPUT_PHONE_NUMBER":
    case "INPUT_LINK":
    case "INPUT_DATE":
    case "INPUT_TIME":
    case "MULTIPLE_CHOICE_OPTION":
    case "CHECKBOX":
    case "DROPDOWN_OPTION":
    case "MULTI_SELECT_OPTION":
    case "RATING":
    case "LINEAR_SCALE":
    case "RANKING_OPTION":
    case "MATRIX_ROW":
    case "MATRIX_COLUMN":
    case "FILE_UPLOAD":
    case "SIGNATURE":
    case "CONDITIONAL_LOGIC":
    case "HIDDEN_FIELDS":
    case "CALCULATED_FIELDS":
      return null;
    case "IMAGE":
    case "EMBED_VIDEO":
    case "EMBED_AUDIO":
    case "EMBED_MAP":
    case "EMBED_LINK":
      return <MediaBlock block={block} />;
  }
}

function ThankYou({ page }: { page: Page | null }) {
  const t = useT();
  const resolve = useResolveMentions();
  const payload = (page?.breakBlock?.payload ?? {}) as {
    title?: string;
    message?: string;
  };
  return (
    <div role="status" className="forms-thank-you">
      <h1 className="forms-title text-[40px] font-extrabold leading-[48px]">
        {payload.title
          ? resolve(payload.title)
          : t("forms.respond.thankYouTitle")}
      </h1>
      <p className="mt-3 text-base">
        {payload.message
          ? resolve(payload.message)
          : t("forms.respond.thankYouMessage")}
      </p>
      {page?.blocks.map((block) => (
        <StaticBlock key={block.uuid} block={block} />
      ))}
      <p className="sr-only">{t("forms.respond.formSubmitted")}</p>
    </div>
  );
}

function errorMap(errors: ValidationError[]) {
  return new Map(errors.map((error) => [error.questionId, error]));
}

export function FormRunner(props: FormRunnerProps) {
  const t = useT();
  const { blocks, mode } = props;
  const settings = useMemo(() => props.settings ?? {}, [props.settings]);
  // A form may name its own final button; empty keeps the built-in copy.
  const submitLabel = settings.submitLabel?.trim() ?? "";
  const live = useLiveRespondent(
    props.mode === "live" ? props.formId : "",
    settings,
    props.mode === "live" ? props.password : undefined,
  );
  const respondent = mode === "live" ? live : previewRespondent;

  const pages = useMemo(() => splitPages(blocks), [blocks]);
  const questions = useMemo(() => deriveQuestions(blocks), [blocks]);
  const questionById = useMemo(
    () => new Map(questions.map((question) => [question.id, question])),
    [questions],
  );

  const [answers, setAnswers] = useState<Answers>(() => {
    const hiddenIds = new Set(hiddenFieldsOf(blocks).map((field) => field.id));
    const restored = Object.entries(respondent.initialAnswers()).filter(
      ([id]) => !hiddenIds.has(id),
    );
    return {
      ...defaultAnswers(questions),
      ...Object.fromEntries(restored),
      ...(mode === "live"
        ? hiddenFieldAnswers(blocks, window.location.search)
        : {}),
    };
  });
  const withCalculated = useCallback(
    (given: Answers): Answers => ({
      ...given,
      ...calculateFields(blocks, given),
    }),
    [blocks],
  );
  const values = useMemo(
    () => withCalculated(answers),
    [withCalculated, answers],
  );
  const [stack, setStack] = useState<PageStack>(initialStack);
  const [errors, setErrors] = useState<Map<string, ValidationError>>(new Map());
  const [phase, setPhase] = useState<Phase>("filling");
  const [submissionId, setSubmissionId] = useState("");
  const [visitorId, setVisitorId] = useState("");
  const [failed, setFailed] = useState(false);
  const [verify, setVerify] = useState<VerifyState | null>(null);
  const [code, setCode] = useState("");
  const started = useRef(false);
  const answered = useRef(new Set<string>());
  const body = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  const pageNumber = currentPage(stack);
  const page = pages[pageNumber - 1] ?? pageAt(pages, 1);
  const state = useMemo(() => evaluatePage(page, values), [page, values]);
  const button = buttonFor(pages, pageNumber, values, state);
  const inputPageCount = pages.filter(
    (candidate) => !candidate.isThankYou,
  ).length;

  useEffect(() => {
    if (mode === "live") setVisitorId(respondentId());
  }, [mode]);

  const formName = formTitleOf(blocks);
  const resolveText = useCallback(
    (text: string) =>
      resolveMentions(text, (ref) => {
        if (ref.kind === "meta")
          return {
            "submission-id": submissionId,
            "respondent-id": visitorId,
            "form-name": formName,
          }[ref.field];
        const question = questionById.get(ref.questionId);
        const value = values[ref.questionId];
        return question && value != null ? answerToText(question, value) : "";
      }),
    [values, questionById, submissionId, visitorId, formName],
  );

  useEffect(() => {
    if (phase === "filling") respondent.persist(answers);
  }, [answers, phase, respondent]);

  useEffect(() => {
    if (phase !== "filling") return;
    respondent.event("page_view", { page: pageNumber });
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    body.current?.querySelector<HTMLElement>(FIELD_SELECTOR)?.focus();
  }, [pageNumber, phase, respondent]);

  const visible = useMemo(
    () =>
      new Set(
        state.visibleBlocks
          .filter((block) => questionTypeOfBlock(block))
          .map((block) => block.groupUuid),
      ),
    [state],
  );
  const shownErrors = [...errors.values()].filter((error) =>
    visible.has(error.questionId),
  );

  function pageErrors(next: Answers, forState: PageState, forPage: Page) {
    return validatePage(forPage, forState, questions, withCalculated(next));
  }

  function change(question: DerivedQuestion, value: AnswerValue) {
    const next = { ...answers, [question.id]: value };
    setAnswers(next);
    setVerify(null);
    if (!started.current) {
      started.current = true;
      respondent.event("start");
    }
    if (!answered.current.has(question.id)) {
      answered.current.add(question.id);
      respondent.event("question_answer", { questionId: question.id });
    }
    if (!errors.has(question.id)) return;
    const stillWrong = pageErrors(
      next,
      evaluatePage(page, withCalculated(next)),
      page,
    ).find((error) => error.questionId === question.id);
    setErrors((previous) => {
      const copy = new Map(previous);
      if (stillWrong) copy.set(question.id, stillWrong);
      else copy.delete(question.id);
      return copy;
    });
  }

  function checkOnBlur(question: DerivedQuestion) {
    if (isEmptyAnswer(answers[question.id])) return;
    const found = pageErrors(answers, state, page).find(
      (error) => error.questionId === question.id,
    );
    if (!found) return;
    setErrors((previous) => new Map(previous).set(question.id, found));
  }

  async function complete(verificationCode?: string) {
    setPhase("submitting");
    setFailed(false);
    let result;
    try {
      result = await respondent.submit(answers, verificationCode);
    } catch {
      // coercion-ok: any failed submit shows the retry banner and keeps the answers.
      setPhase("filling");
      setFailed(true);
      return;
    }
    if (result.ok) {
      setSubmissionId(result.submissionId);
      respondent.finish();
      const redirect = settings.redirectOnCompletion;
      if (
        mode === "live" &&
        redirect?.enabled &&
        /^https?:\/\//.test(redirect.url)
      )
        window.location.assign(redirect.url);
      setPhase("done");
      return;
    }
    if (
      result.reason === "verify" ||
      result.reason === "wrong_code" ||
      result.reason === "code_expired" ||
      result.reason === "code_limit" ||
      result.reason === "verify_unavailable"
    ) {
      const reason: VerifyReason = result.reason;
      setVerify({ email: result.verifyEmail ?? "", reason });
      setCode("");
      setPhase("filling");
      return;
    }
    if (result.reason === "closed") return setPhase("closed");
    if (result.reason === "unavailable") return setPhase("unavailable");
    if (result.reason === "duplicate") return setPhase("duplicate");
    setErrors(errorMap(result.errors));
    const first = result.errors[0];
    const target = first ? questionById.get(first.questionId) : undefined;
    if (target && target.pageNumber !== pageNumber)
      setStack((previous) => pushPage(previous, target.pageNumber));
    setPhase("filling");
    setFailed(true);
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (button === "hidden" || phase !== "filling") return;
    if (verify) {
      if (code.trim()) void complete(code.trim());
      return;
    }
    const found = pageErrors(answers, state, page);
    setErrors(errorMap(found));
    if (found.length > 0) {
      body.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
      return;
    }
    const next = resolveNextStep(pages, pageNumber, values);
    if (next.kind === "page")
      setStack((previous) => pushPage(previous, next.page));
    else void complete();
  }

  if (phase === "closed") return <ClosedState preview={mode === "preview"} />;
  if (phase === "unavailable") return <UnavailableState />;
  if (phase === "duplicate") return <DuplicateState />;

  const frame = (children: React.ReactNode) => (
    <ThemedSurface
      settings={settings}
      withCss
      className={
        mode === "preview"
          ? "flex-1 pt-[151px] pb-32"
          : "min-h-[calc(100vh/var(--fs-scale,1))]"
      }
    >
      <Frame preview={mode === "preview"}>
        <MentionValuesContext.Provider value={resolveText}>
          {children}
        </MentionValuesContext.Provider>
      </Frame>
    </ThemedSurface>
  );
  if (phase === "done") return frame(<ThankYou page={thankYouPage(pages)} />);

  const seen = new Set<string>();
  const submitting = phase === "submitting";

  return frame(
    <form noValidate onSubmit={onSubmit} className="forms-page">
      <progress
        aria-label={t("forms.respond.progressLabel")}
        aria-valuetext={t("forms.respond.progressValue", {
          page: stack.length,
          total: inputPageCount,
        })}
        className="sr-only"
        value={pageNumber}
        max={inputPageCount}
      />
      {settings.progressBar === true ? (
        <div
          aria-hidden
          className="mb-8 h-1 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full bg-foreground transition-[width]"
            style={{ width: `${(pageNumber / inputPageCount) * 100}%` }}
          />
        </div>
      ) : null}
      {failed ? (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-destructive px-3 py-2 text-sm text-destructive"
        >
          {t("forms.respond.submitFailed")}
        </div>
      ) : null}
      <div ref={body}>
        {state.visibleBlocks.map((block) => {
          if (!questionTypeOfBlock(block) && block.type !== "TITLE")
            return <StaticBlock key={block.uuid} block={block} />;
          const question = questionById.get(block.groupUuid);
          if (!question) return <StaticBlock key={block.uuid} block={block} />;
          if (seen.has(question.id)) return null;
          seen.add(question.id);
          const error = errors.get(question.id);
          return (
            <QuestionField
              key={question.id}
              question={{ ...question, title: resolveText(question.title) }}
              value={answers[question.id]}
              required={
                question.isRequired || state.requiredIds.has(question.id)
              }
              invalid={!!error}
              formId={props.mode === "live" ? props.formId : null}
              message={error ? validationMessage(t, error) : null}
              onChange={(value) => change(question, value)}
              onBlur={() => checkOnBlur(question)}
            />
          );
        })}
      </div>
      {verify ? (
        <VerifyEmailStep
          state={verify}
          code={code}
          disabled={submitting}
          onCode={setCode}
          onResend={() => void complete()}
        />
      ) : null}
      {button === "hidden" ? null : (
        <div className="forms-actions my-[10px]">
          <div className="flex items-center gap-3">
            {stack.length > 1 ? (
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                className="forms-button h-9 rounded-[var(--fs-button-radius)] px-3.5 text-[15px] font-semibold"
                onClick={() => setStack(popPage)}
              >
                {t("forms.respond.back")}
              </Button>
            ) : null}
            <Button
              type="submit"
              disabled={submitting}
              className="forms-button h-9 gap-1.5 rounded-[var(--fs-button-radius)] bg-[var(--fs-button-bg)] px-[13.5px] py-0 text-[15px] leading-[22.5px] font-normal text-[var(--fs-button-text)] hover:bg-[var(--fs-button-bg)] hover:opacity-85"
            >
              <span className="font-semibold">
                {verify
                  ? t("forms.notify.verify")
                  : button === "submit"
                    ? submitLabel || t("forms.respond.submit")
                    : t("forms.respond.next")}
              </span>
              <i className="flex">
                {submitting ? (
                  <IconLoader2 className="size-[18px] animate-spin" />
                ) : (
                  <IconArrowRight className="size-4" />
                )}
              </i>
            </Button>
          </div>
        </div>
      )}
      <p role="status" className="sr-only">
        {shownErrors.length > 0
          ? t("forms.respond.attention", { count: shownErrors.length })
          : ""}
      </p>
    </form>,
  );
}
