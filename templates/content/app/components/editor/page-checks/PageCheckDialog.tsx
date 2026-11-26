import { useT } from "@agent-native/core/client/i18n";
import {
  evaluatePageCheckPart,
  PAGE_CHECK_SENTENCE_MAX_LENGTH,
  pageCheckHeadingsIn,
  pageCheckPlacesIn,
  readPageCheckBody,
  readPageCheckSentence,
  type PageCheckPart,
  type PageCheckPlaces,
  type PageCheckScope,
  type PageCheckView,
} from "@shared/page-checks";
import { useId, useMemo, useState } from "react";

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
import { Textarea } from "@/components/ui/textarea";

import { pageCheckMissText, pageCheckScopeLabel } from "./page-check-format";
import {
  usePageChecksActions,
  usePageChecksState,
  type PageChecksActions,
  type PageChecksState,
} from "./page-checks-context";

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
  const [sentence, setSentence] = useState(editing?.sentence ?? "");
  const [scope, setScope] = useState<PageCheckScope>(initialScope);
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
  const unread = reading.parts.filter((part) => part.kind === "unread");
  const readable = !reading.tooManyParts && unread.length === 0;
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

  return (
    <DialogContent className="max-w-md gap-4" data-page-check-dialog>
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
                if (index < sections.length) setScope(sections[index]);
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
        {trimmed ? (
          <PageCheckTryLines
            parts={reading.parts}
            tooManyParts={reading.tooManyParts}
            places={places}
            each={scope.kind === "each_paragraph"}
          />
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

function PageCheckTryLines({
  parts,
  tooManyParts,
  places,
  each,
}: {
  parts: ReturnType<typeof readPageCheckSentence>["parts"];
  tooManyParts: boolean;
  places: PageCheckPlaces;
  each: boolean;
}) {
  const t = useT();
  const lines = parts.map((part) => {
    if (part.kind === "unread") {
      return {
        text: part.text,
        miss: false,
        unread: true,
        result: t("pageChecks.cantReadYet"),
      };
    }
    return {
      text: part.text,
      unread: false,
      ...tryPart(t, part, places, each),
    };
  });
  return (
    <div
      className="grid gap-1.5 text-sm"
      aria-live="polite"
      data-page-check-try
    >
      {lines.map((line, index) => (
        <p key={index} className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className="page-check-dot mt-[0.45em]"
            data-shape={line.miss ? "filled" : line.unread ? "ring" : undefined}
          />
          <span>
            {line.text}: <span className="font-semibold">{line.result}</span>
          </span>
        </p>
      ))}
      {lines.some((line) => line.unread) ? (
        <p className="text-xs text-muted-foreground">
          {t("pageChecks.unreadHelp")}
        </p>
      ) : null}
      {tooManyParts ? (
        <p className="text-xs text-destructive">
          {t("pageChecks.tooManyParts")}
        </p>
      ) : null}
    </div>
  );
}

function tryPart(
  t: ReturnType<typeof useT>,
  part: PageCheckPart,
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
      : pageCheckMissText(t, [part], [misses[0]]),
  };
}
