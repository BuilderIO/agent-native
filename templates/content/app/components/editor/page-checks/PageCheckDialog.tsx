import { useT } from "@agent-native/core/client/i18n";
import {
  evaluatePageCheckPart,
  PAGE_CHECK_QUESTION_MAX_LENGTH,
  PAGE_CHECK_SENTENCE_MAX_LENGTH,
  PAGE_CHECK_SURE_SETTINGS,
  pageCheckHeadingsIn,
  pageCheckPartFinding,
  pageCheckPlacesIn,
  pageCheckSureCounts,
  readPageCheckBody,
  readPageCheckSentence,
  type PageCheckCountPart,
  type PageCheckPartResult,
  type PageCheckPlaces,
  type PageCheckProblem,
  type PageCheckQuestionInput,
  type PageCheckScope,
  type PageCheckSure,
  type PageCheckTry,
  type PageCheckView,
} from "@shared/page-checks";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

import {
  PAGE_CHECK_SURE_LABELS,
  pageCheckCouldntText,
  pageCheckMissText,
  pageCheckScopeLabel,
} from "./page-check-format";
import {
  usePageChecksActions,
  usePageChecksState,
  type PageChecksActions,
  type PageChecksState,
} from "./page-checks-context";

/** Yes/no parts are tried this long after the last keystroke. */
const TRY_PAUSE_MS = 700;

type Questions = Record<string, Omit<PageCheckQuestionInput, "text">>;

/** What a yes/no part's line says when it can't be asked yet. */
const PROBLEM_LINES: Record<PageCheckProblem["kind"], string> = {
  unreadable: "pageChecks.couldnt",
  vague: "pageChecks.tooVague",
  unwritten: "pageChecks.noQuestion",
  no_model: "pageChecks.couldntNoModel",
};

type Tried =
  | { key: string; status: "done"; result: PageCheckTry }
  | { key: string; status: "failed" };

export function PageCheckDialog() {
  const actions = usePageChecksActions();
  const state = usePageChecksState();
  const dialog = state?.dialog ?? null;
  const editing =
    dialog?.mode === "edit"
      ? state?.checks.find((check) => check.id === dialog.checkId)
      : undefined;
  const open = dialog?.mode === "add" || !!editing;
  return (
    <Dialog
      open={open && !!actions}
      onOpenChange={(next) => {
        if (!next) actions?.closeDialog();
      }}
    >
      {open && actions && state ? (
        <PageCheckForm
          key={editing?.id ?? "add"}
          actions={actions}
          state={state}
          editing={editing}
          initialScope={
            editing?.scope ??
            (dialog?.mode === "add" ? dialog.scope : { kind: "intro" })
          }
        />
      ) : null}
    </Dialog>
  );
}

function questionsOf(check: PageCheckView | undefined): Questions {
  const questions: Questions = {};
  for (const part of check?.parts ?? []) {
    if (part.kind === "question") {
      questions[part.text] = { question: part.question, passes: part.passes };
    }
  }
  return questions;
}

function PageCheckForm({
  actions,
  state,
  editing,
  initialScope,
}: {
  actions: PageChecksActions;
  state: PageChecksState;
  editing: PageCheckView | undefined;
  initialScope: PageCheckScope;
}) {
  const t = useT();
  const sentenceId = useId();
  const whereId = useId();
  const sureId = useId();
  const [sentence, setSentence] = useState(editing?.sentence ?? "");
  const [scope, setScope] = useState<PageCheckScope>(initialScope);
  const [sure, setSure] = useState<PageCheckSure>(editing?.sure ?? "balanced");
  // Questions the model wrote, and the ones the person changed. Only a
  // person's change tries the check again.
  const [written, setWritten] = useState<Questions>(() => questionsOf(editing));
  const [edited, setEdited] = useState<Questions>({});
  const [tried, setTried] = useState<Tried | null>(null);
  const [saving, setSaving] = useState(false);

  const markdown = state.live?.markdown ?? actions.bodyMarkdown();
  const idsByPath = state.live?.idsByPath;
  const body = useMemo(
    () => readPageCheckBody(markdown, idsByPath ?? {}),
    [idsByPath, markdown],
  );
  const headings = useMemo(() => pageCheckHeadingsIn(body), [body]);
  const sections = useMemo(() => {
    const options: Extract<PageCheckScope, { kind: "section" }>[] =
      headings.map((heading) => ({
        kind: "section",
        headingId: heading.headingId,
        heading: heading.heading,
        level: heading.level,
      }));
    if (
      scope.kind === "section" &&
      !options.some((option) => sameSection(option, scope))
    ) {
      options.push(scope);
    }
    return options;
  }, [headings, scope]);
  const reading = useMemo(() => readPageCheckSentence(sentence), [sentence]);
  const places = useMemo(() => pageCheckPlacesIn(body, scope), [body, scope]);

  const trimmed = sentence.trim();
  const asks =
    !reading.tooManyParts &&
    reading.parts.some((part) => part.kind === "unread");
  const questions = useMemo(
    () =>
      reading.parts.flatMap((part): PageCheckQuestionInput[] => {
        if (part.kind !== "unread") return [];
        const question = edited[part.text] ?? written[part.text];
        return question ? [{ text: part.text, ...question }] : [];
      }),
    [edited, reading, written],
  );
  const tryKey = useMemo(
    () =>
      asks
        ? JSON.stringify({
            sentence: trimmed,
            scope,
            edited: questions.filter((question) => edited[question.text]),
          })
        : null,
    [asks, edited, questions, scope, trimmed],
  );

  // Only a new key tries again: How sure re-reads the answers in hand.
  const tryInput = useRef({ sentence: trimmed, scope, questions, sure });
  useEffect(() => {
    tryInput.current = { sentence: trimmed, scope, questions, sure };
  });
  useEffect(() => {
    if (!tryKey) return;
    let current = true;
    const timer = setTimeout(() => {
      actions
        .tryCheck(tryInput.current)
        .then((result) => {
          if (!current) return;
          setTried({ key: tryKey, status: "done", result });
          const fresh: Questions = {};
          for (const part of result.parts ?? []) {
            if (part.kind === "question") {
              fresh[part.text] = {
                question: part.question,
                passes: part.passes,
              };
            }
          }
          setWritten((before) => ({ ...fresh, ...before }));
        })
        .catch(() => {
          if (current) setTried({ key: tryKey, status: "failed" });
        });
    }, TRY_PAUSE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [actions, tryKey]);

  const triedNow = tried !== null && tried.key === tryKey ? tried : null;
  const result = triedNow?.status === "done" ? triedNow.result : null;
  const trying = asks && !triedNow;
  const problem = result?.problem ?? null;
  const readable =
    !reading.tooManyParts &&
    reading.parts.length > 0 &&
    (!asks ||
      triedNow?.status === "failed" ||
      (result !== null && result.parts !== null));
  const canSave =
    !saving &&
    trimmed.length > 0 &&
    trimmed.length <= PAGE_CHECK_SENTENCE_MAX_LENGTH &&
    readable;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    const saved = await actions.save({
      checkId: editing?.id,
      sentence: trimmed,
      scope,
      questions: asks ? questions : undefined,
      sure,
    });
    setSaving(false);
    if (saved) actions.closeDialog();
  };

  const remove = async (checkId: string) => {
    setSaving(true);
    const removed = await actions.remove(checkId);
    setSaving(false);
    if (removed) actions.closeDialog();
  };

  const selected =
    scope.kind === "section"
      ? `section:${sections.findIndex((option) => sameSection(option, scope))}`
      : scope.kind;
  const sureCounts = result?.answers
    ? pageCheckSureCounts(result.answers)
    : null;

  return (
    <DialogContent className="max-w-md" data-page-check-dialog>
      <DialogHeader className="text-start">
        <DialogTitle>
          {editing ? t("pageChecks.editCheck") : t("pageChecks.addCheck")}
        </DialogTitle>
        <DialogDescription>
          {t("pageChecks.addCheckDescription")}
        </DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor={sentenceId}>{t("pageChecks.keepItLikeThis")}</Label>
          <Textarea
            id={sentenceId}
            value={sentence}
            maxLength={PAGE_CHECK_SENTENCE_MAX_LENGTH}
            rows={2}
            autoFocus
            placeholder={t("pageChecks.sentencePlaceholder")}
            onChange={(event) => setSentence(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void save();
              }
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={whereId}>{t("pageChecks.where")}</Label>
          <select
            id={whereId}
            value={selected}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value.startsWith("section:")) {
                const index = Number(value.slice(8));
                const section = sections.find((_, at) => at === index);
                if (section) setScope(section);
              } else {
                setScope({ kind: value } as PageCheckScope);
              }
            }}
          >
            <option value="page">{t("pageChecks.scopePage")}</option>
            <option value="intro">{t("pageChecks.scopeIntro")}</option>
            {sections.map((section, index) => (
              <option
                key={`${index}:${section.heading}`}
                value={`section:${index}`}
              >
                {pageCheckScopeLabel(t, section)}
              </option>
            ))}
            <option value="each_paragraph">
              {t("pageChecks.scopeEachParagraph")}
            </option>
          </select>
        </div>
        {asks ? (
          <div className="grid gap-1.5">
            <Label id={sureId}>{t("pageChecks.howSure")}</Label>
            <RadioGroup
              value={sure}
              onValueChange={(value) => setSure(value as PageCheckSure)}
              aria-labelledby={sureId}
              aria-describedby={`${sureId}-help`}
              className="flex flex-wrap"
              data-page-check-sure
            >
              {PAGE_CHECK_SURE_SETTINGS.map((setting) => (
                <div key={setting} className="me-4 flex items-center gap-1.5">
                  <RadioGroupItem value={setting} id={`${sureId}-${setting}`} />
                  <Label htmlFor={`${sureId}-${setting}`}>
                    {t(PAGE_CHECK_SURE_LABELS[setting])}
                    {sureCounts ? (
                      <span
                        className="ms-1.5 text-muted-foreground"
                        data-page-check-sure-count
                      >
                        {sureCounts[setting]}
                      </span>
                    ) : null}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            <p id={`${sureId}-help`} className="text-xs text-muted-foreground">
              {t("pageChecks.sureHelp")}
            </p>
          </div>
        ) : null}
        {trimmed ? (
          <PageCheckTryLines
            reading={reading}
            places={places}
            each={scope.kind === "each_paragraph"}
            sure={sure}
            trying={trying}
            failed={triedNow?.status === "failed"}
            result={result}
            questions={questions}
            onQuestion={(text, question) =>
              setEdited((before) => ({ ...before, [text]: question }))
            }
            onExample={(text, example) =>
              setSentence((before) => before.replace(text, example))
            }
          />
        ) : null}
        {asks && result?.decider && !problem ? (
          <p className="text-xs text-muted-foreground" data-page-check-model>
            {t("pageChecks.modelNotice", {
              model: result.decider.model,
              company: result.decider.company,
            })}
          </p>
        ) : null}
        <DialogFooter className="flex-row flex-wrap items-center gap-2 sm:space-x-0">
          {editing ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={() => {
                  void actions.setPaused(editing.id, !editing.paused);
                  actions.closeDialog();
                }}
              >
                {editing.paused
                  ? t("pageChecks.resume")
                  : t("pageChecks.pause")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={saving}
                onClick={() => void remove(editing.id)}
              >
                {t("pageChecks.delete")}
              </Button>
            </>
          ) : null}
          <span className="flex-1" />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => actions.closeDialog()}
          >
            {t("pageChecks.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={!canSave}>
            {editing ? t("pageChecks.save") : t("pageChecks.addCheck")}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function sameSection(
  a: Extract<PageCheckScope, { kind: "section" }>,
  b: Extract<PageCheckScope, { kind: "section" }>,
) {
  if (a.headingId && b.headingId) return a.headingId === b.headingId;
  return a.heading === b.heading && a.level === b.level;
}

interface TryLine {
  text: string;
  miss: boolean;
  waiting: boolean;
  result: string;
}

function PageCheckTryLines({
  reading,
  places,
  each,
  sure,
  trying,
  failed,
  result,
  questions,
  onQuestion,
  onExample,
}: {
  reading: ReturnType<typeof readPageCheckSentence>;
  places: PageCheckPlaces;
  each: boolean;
  sure: PageCheckSure;
  trying: boolean;
  failed: boolean;
  result: PageCheckTry | null;
  questions: readonly PageCheckQuestionInput[];
  onQuestion: (
    text: string,
    question: Omit<PageCheckQuestionInput, "text">,
  ) => void;
  onExample: (text: string, example: string) => void;
}) {
  const t = useT();
  const problem = result?.problem ?? null;
  const lines = reading.parts.map((part, index): TryLine => {
    if (part.kind === "count") {
      return {
        text: part.text,
        waiting: false,
        ...countLine(t, part, places, each),
      };
    }
    if (trying) {
      return {
        text: part.text,
        miss: false,
        waiting: true,
        result: t("pageChecks.checking"),
      };
    }
    if (failed || !result?.answers) {
      return {
        text: part.text,
        miss: false,
        waiting: true,
        result: t(problem ? PROBLEM_LINES[problem.kind] : "pageChecks.couldnt"),
      };
    }
    return {
      text: part.text,
      waiting: false,
      ...questionLine(t, result, index, sure, places, each),
    };
  });
  return (
    <div
      className="grid gap-1.5 text-sm"
      aria-live="polite"
      aria-busy={trying}
      data-page-check-try
    >
      {lines.map((line, index) => {
        const question = questions.find(
          (candidate) => candidate.text === line.text,
        );
        const part = reading.parts.find((_, at) => at === index);
        return (
          <div key={index} className="grid gap-1">
            <p className="flex items-start gap-2">
              <span
                aria-hidden="true"
                className="page-check-dot mt-[0.45em]"
                data-shape={
                  line.miss ? "filled" : line.waiting ? "ring" : undefined
                }
              />
              <span>
                {line.text}:{" "}
                <span className="font-semibold">{line.result}</span>
              </span>
            </p>
            {part?.kind === "unread" && !trying && !problem ? (
              <QuestionLine
                text={part.text}
                question={question}
                onChange={(next) => onQuestion(part.text, next)}
              />
            ) : null}
          </div>
        );
      })}
      {problem?.kind === "vague" ? (
        <div className="grid gap-1.5" data-page-check-vague>
          <p className="text-xs text-destructive">
            {t("pageChecks.vague", { part: problem.text })}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {problem.examples.map((example) => (
              <Button
                key={example}
                type="button"
                variant="outline"
                size="sm"
                className="h-auto whitespace-normal text-start"
                onClick={() => onExample(problem.text, example)}
              >
                {example}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      {problem?.kind === "no_model" ? (
        <p className="text-xs text-destructive">{t("pageChecks.noModel")}</p>
      ) : null}
      {problem?.kind === "unwritten" ? (
        <div className="grid gap-1.5">
          <p className="text-xs text-destructive">
            {t("pageChecks.unwritten")}
          </p>
          {problem.texts.map((text) => (
            <QuestionLine
              key={text}
              text={text}
              question={questions.find((candidate) => candidate.text === text)}
              startEditing
              onChange={(next) => onQuestion(text, next)}
            />
          ))}
        </div>
      ) : null}
      {reading.tooManyParts ? (
        <p className="text-xs text-destructive">
          {t("pageChecks.tooManyParts")}
        </p>
      ) : null}
    </div>
  );
}

function QuestionLine({
  text,
  question,
  startEditing = false,
  onChange,
}: {
  text: string;
  question: Omit<PageCheckQuestionInput, "text"> | undefined;
  startEditing?: boolean;
  onChange: (question: Omit<PageCheckQuestionInput, "text">) => void;
}) {
  const t = useT();
  const questionId = useId();
  const [open, setOpen] = useState(startEditing);
  const [draft, setDraft] = useState(question?.question ?? "");
  const [passes, setPasses] = useState(question?.passes ?? "yes");
  if (!open) {
    if (!question) return null;
    return (
      <p
        className="flex flex-wrap items-baseline gap-x-2 ps-4 text-xs text-muted-foreground"
        data-page-check-question
      >
        <span>
          {t("pageChecks.asks", { question: question.question })}{" "}
          {question.passes === "yes"
            ? t("pageChecks.passesOnYes")
            : t("pageChecks.passesOnNo")}
        </span>
        <Button
          type="button"
          variant="link"
          size="xs"
          className="h-auto"
          onClick={() => {
            setDraft(question.question);
            setPasses(question.passes);
            setOpen(true);
          }}
        >
          {t("pageChecks.editQuestion")}
        </Button>
      </p>
    );
  }
  const commit = () => {
    const next = draft.trim();
    if (next) onChange({ question: next, passes });
  };
  return (
    <div className="grid gap-1.5 ps-4" data-page-check-question-edit>
      <Label htmlFor={questionId}>
        {t("pageChecks.questionFor", { part: text })}
      </Label>
      <Textarea
        id={questionId}
        value={draft}
        rows={2}
        maxLength={PAGE_CHECK_QUESTION_MAX_LENGTH}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
      />
      <RadioGroup
        value={passes}
        onValueChange={(value) => {
          const next = value === "no" ? "no" : "yes";
          setPasses(next);
          if (draft.trim()) onChange({ question: draft.trim(), passes: next });
        }}
        aria-label={t("pageChecks.passesWhen")}
        className="flex flex-wrap items-center"
      >
        <span className="me-3 text-xs text-muted-foreground">
          {t("pageChecks.passesWhen")}
        </span>
        {(["yes", "no"] as const).map((answer) => (
          <div key={answer} className="me-3 flex items-center gap-1.5">
            <RadioGroupItem value={answer} id={`${questionId}-${answer}`} />
            <Label htmlFor={`${questionId}-${answer}`}>
              {answer === "yes" ? t("pageChecks.yes") : t("pageChecks.no")}
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}

function countLine(
  t: ReturnType<typeof useT>,
  part: PageCheckCountPart,
  places: PageCheckPlaces,
  each: boolean,
): { miss: boolean; result: string } {
  if (places.status === "section_deleted") {
    return { miss: false, result: t("pageChecks.sectionDeleted") };
  }
  if (places.places.length === 0) {
    return { miss: false, result: t("pageChecks.nothingMatches") };
  }
  const results = places.places.map((place) =>
    evaluatePageCheckPart(part, place),
  );
  const misses = results.filter((result) => result.finding === "not_fine");
  if (misses.length === 0) return { miss: false, result: t("pageChecks.fine") };
  return {
    miss: true,
    result: each
      ? t("pageChecks.ofTotal", {
          missing: misses.length,
          total: results.length,
        })
      : pageCheckMissText(
          t,
          { parts: [part], sure: "balanced" },
          misses.slice(0, 1),
        ),
  };
}

function questionLine(
  t: ReturnType<typeof useT>,
  result: PageCheckTry,
  index: number,
  sure: PageCheckSure,
  places: PageCheckPlaces,
  each: boolean,
): { miss: boolean; result: string } {
  if (places.status === "section_deleted") {
    return { miss: false, result: t("pageChecks.sectionDeleted") };
  }
  const answered = (result.answers ?? []).flatMap(
    (answer): PageCheckPartResult[] => {
      const part = answer.result?.parts.find((_, at) => at === index);
      return part ? [part] : [];
    },
  );
  if (answered.length === 0) {
    return { miss: false, result: t("pageChecks.nothingMatches") };
  }
  const missing = answered.filter(
    (part) => pageCheckPartFinding(part, sure) === "not_fine",
  ).length;
  const couldnt = answered.find((part) => part.finding === "couldnt");
  if (missing === 0 && couldnt) {
    return { miss: false, result: pageCheckCouldntText(t, couldnt.reason) };
  }
  if (missing === 0) return { miss: false, result: t("pageChecks.fine") };
  return {
    miss: true,
    result: each
      ? t("pageChecks.ofTotal", { missing, total: answered.length })
      : t("pageChecks.notFine"),
  };
}
