import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  ActionCard,
  registerToolRenderer,
} from "@agent-native/toolkit/app/chat";
import {
  registerActionChatRenderer,
  type ToolRendererProps,
} from "@agent-native/toolkit/app/chat/agentkit-chat/index";
import { type ToolRendererContext } from "@agent-native/toolkit/app/chat/chat";
import { ToolCallDisplay } from "@agent-native/toolkit/app/chat/chat/tool-call-display";
import {
  projectSlidesAddedSlidePreview,
  projectSlidesAddedSlideResult,
  SLIDES_ADDED_SLIDE_RESULT_RENDERER,
  projectSlidesViewScreenResult,
  SLIDES_VIEW_SCREEN_RESULT_RENDERER,
  projectSlidesDeckResult,
  SLIDES_DECK_RESULT_RENDERER,
  type SlidesDeckPreview,
} from "@shared/action-ui";
import { IconPresentation } from "@tabler/icons-react";
import { Link } from "react-router";

import {
  SLIDES_2_CANVAS_HEIGHT,
  SLIDES_2_CANVAS_WIDTH,
} from "@/components/slides-2-runtime/constants";
import type { SlideRenderArtifact } from "@/components/slides-2-runtime/protocol";
import { SandboxedSlide } from "@/components/slides-2-runtime/SandboxedSlide";
import { Slides2Canvas } from "@/components/slides-2-runtime/Slides2Canvas";
import { DeckTemplatePreview } from "@/components/templates/DeckTemplatePreview";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import slidesStylesheet from "../global.css?url";

const MAX_DECK_RESULT_PREVIEWS = 3;
const MAX_ORIGINAL_PROMPT_LENGTH = 4_000;

function projectOriginalPrompt(args: unknown): string | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args))
    return undefined;
  const promptDraft = (args as Record<string, unknown>).promptDraft;
  if (
    !promptDraft ||
    typeof promptDraft !== "object" ||
    Array.isArray(promptDraft)
  ) {
    return undefined;
  }
  const generationContext = (promptDraft as Record<string, unknown>)
    .generationContext;
  if (
    !generationContext ||
    typeof generationContext !== "object" ||
    Array.isArray(generationContext)
  ) {
    return undefined;
  }
  return projectOriginalPromptFromGenerationContext(generationContext);
}

function projectOriginalPromptFromGenerationContext(
  generationContext: unknown,
): string | undefined {
  if (
    !generationContext ||
    typeof generationContext !== "object" ||
    Array.isArray(generationContext)
  ) {
    return undefined;
  }
  const originalPrompt = (generationContext as Record<string, unknown>)
    .originalPrompt;
  return typeof originalPrompt === "string" &&
    originalPrompt.trim().length > 0 &&
    originalPrompt.length <= MAX_ORIGINAL_PROMPT_LENGTH
    ? originalPrompt.trim()
    : undefined;
}

function submitSlidesRegeneration(target: {
  deckId: string;
  deckTitle: string;
  slideId?: string;
  slideNumber?: number;
  originalPrompt?: string;
}) {
  const isSlideTarget = Boolean(target.slideId);
  sendToAgentChat({
    message: isSlideTarget
      ? `Regenerate this slide in the saved deck from its original request. Read the current deck and saved generation context first, update only the target slide, and preserve all other slides. If the original request is unavailable, ask me what to change before writing.`
      : `Regenerate this saved deck from its original request. Read the current deck and saved generation context first, update the existing deck in place, and preserve its deck ID. If the original request is unavailable, ask me what to change before writing.`,
    context: JSON.stringify({
      appId: "slides-2",
      deckId: target.deckId,
      deckTitle: target.deckTitle,
      ...(target.slideId ? { slideId: target.slideId } : {}),
      ...(target.slideNumber === undefined
        ? {}
        : { slideNumber: target.slideNumber }),
      ...(target.originalPrompt
        ? { originalPrompt: target.originalPrompt }
        : {}),
    }),
    submit: true,
    openSidebar: true,
    chatTarget: "local",
  });
}

type WorkerSlidePreview = {
  deckId: string;
  slideId: string;
  slideNumber: number;
  revision: number;
  sourceHash: string;
};

type DeckResultPreview =
  | { kind: "html"; slide: SlidesDeckPreview }
  | { kind: "worker"; slide: WorkerSlidePreview };

function projectWorkerSlidePreview(
  deckId: string,
  slide: unknown,
  slideNumber: number,
  expectedVersion?: Pick<WorkerSlidePreview, "revision" | "sourceHash">,
): WorkerSlidePreview | null {
  if (!slide || typeof slide !== "object" || Array.isArray(slide)) return null;
  const value = slide as Record<string, unknown>;
  const slideId = typeof value.id === "string" ? value.id.trim() : "";
  if (
    !slideId ||
    slideId.length > 200 ||
    typeof value.sourceTsx !== "string" ||
    !value.sourceTsx.trim()
  ) {
    return null;
  }

  const revision = expectedVersion ? expectedVersion.revision : value.revision;
  const sourceHash = expectedVersion
    ? expectedVersion.sourceHash
    : value.sourceHash;
  if (
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    typeof sourceHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(sourceHash)
  ) {
    return null;
  }

  return {
    deckId,
    slideId,
    slideNumber,
    revision,
    sourceHash,
  };
}

function projectDeckResultPreviews(
  value: unknown,
  deckId: string,
  htmlPreviews: SlidesDeckPreview[],
  sourceVersions: ReadonlyMap<
    string,
    Pick<WorkerSlidePreview, "revision" | "sourceHash">
  >,
): DeckResultPreview[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return htmlPreviews.map((slide) => ({ kind: "html", slide }));
  }

  const result = value as Record<string, unknown>;
  const rawSlides = Array.isArray(result.slides)
    ? result.slides.slice(0, 40)
    : null;
  if (!rawSlides) {
    return htmlPreviews.map((slide) => ({ kind: "html", slide }));
  }

  const sourceBackedSlideIds = new Set(
    rawSlides.flatMap((slide, index) => {
      if (!isSourceBackedSlide(slide)) return [];
      const id = typeof slide.id === "string" ? slide.id.trim() : "";
      return [id || `preview-${index + 1}`];
    }),
  );
  const htmlById = new Map(htmlPreviews.map((slide) => [slide.id, slide]));
  const previews: DeckResultPreview[] = [];
  for (const [index, rawSlide] of rawSlides.entries()) {
    const rawId =
      rawSlide &&
      typeof rawSlide === "object" &&
      !Array.isArray(rawSlide) &&
      typeof (rawSlide as Record<string, unknown>).id === "string"
        ? ((rawSlide as Record<string, unknown>).id as string).trim()
        : "";
    const projectedHtml = projectSlidesDeckResult({
      id: deckId,
      title: "Slide preview",
      slideCount: 1,
      slides: [rawSlide],
    })?.previews[0];
    const html = projectedHtml && {
      ...projectedHtml,
      id: rawId || `preview-${index + 1}`,
    };
    const savedHtml = isSourceBackedSlide(rawSlide)
      ? undefined
      : (html ?? htmlById.get(rawId || `preview-${index + 1}`));
    const sourceVersion =
      sourceVersions.get(rawId) ??
      (isSourceBackedSlide(rawSlide)
        ? projectSourceVersion(rawSlide)
        : undefined);
    const workerSlide = sourceVersion
      ? projectWorkerSlidePreview(deckId, rawSlide, index + 1, sourceVersion)
      : null;
    if (workerSlide) previews.push({ kind: "worker", slide: workerSlide });
    else if (savedHtml) previews.push({ kind: "html", slide: savedHtml });
    if (previews.length >= MAX_DECK_RESULT_PREVIEWS) break;
  }

  const fallbackHtml = htmlPreviews.filter(
    (slide) => !sourceBackedSlideIds.has(slide.id),
  );
  return previews.length > 0
    ? previews
    : fallbackHtml.map((slide) => ({ kind: "html", slide }));
}

function isSourceBackedSlide(
  slide: unknown,
): slide is Record<string, unknown> & { sourceTsx: string } {
  if (!slide || typeof slide !== "object" || Array.isArray(slide)) return false;
  const sourceTsx = (slide as Record<string, unknown>).sourceTsx;
  return typeof sourceTsx === "string" && Boolean(sourceTsx.trim());
}

function projectSourceVersionsBySlideId(
  value: unknown,
): Map<string, Pick<WorkerSlidePreview, "revision" | "sourceHash">> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return new Map();
  }

  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.slides)) return new Map();

  const sourceVersions = new Map<
    string,
    Pick<WorkerSlidePreview, "revision" | "sourceHash">
  >();
  const seenSourceSlideIds = new Set<string>();
  for (const slide of result.slides.slice(0, 40)) {
    if (!isSourceBackedSlide(slide)) continue;
    const slideId = typeof slide.id === "string" ? slide.id.trim() : "";
    if (!slideId) continue;
    if (seenSourceSlideIds.has(slideId)) {
      sourceVersions.delete(slideId);
      continue;
    }
    seenSourceSlideIds.add(slideId);
    const sourceVersion = projectSourceVersion(slide);
    if (sourceVersion) sourceVersions.set(slideId, sourceVersion);
  }
  return sourceVersions;
}

function findWorkerSlidePreview(
  value: unknown,
  deckId: string,
  slideId: string,
  expectedVersion?: Pick<WorkerSlidePreview, "revision" | "sourceHash">,
): WorkerSlidePreview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const deck = value as Record<string, unknown>;
  if (deck.id !== deckId || !Array.isArray(deck.slides)) return null;
  const index = deck.slides.findIndex(
    (slide) =>
      slide &&
      typeof slide === "object" &&
      !Array.isArray(slide) &&
      (slide as Record<string, unknown>).id === slideId,
  );
  if (index < 0) return null;

  const slide = deck.slides[index] as Record<string, unknown>;
  const slideNumber = slide.slideNumber;
  const position =
    typeof slideNumber === "number" &&
    Number.isSafeInteger(slideNumber) &&
    slideNumber > 0
      ? slideNumber
      : index + 1;
  return projectWorkerSlidePreview(deckId, slide, position, expectedVersion);
}

function SlidesWorkerSlidePreview({ slide }: { slide: WorkerSlidePreview }) {
  const t = useT();
  const { data, isPending } = useActionQuery(
    "get-slide-render",
    {
      deckId: slide.deckId,
      slideId: slide.slideId,
      expectedRevision: slide.revision,
      expectedSourceHash: slide.sourceHash,
    },
    { enabled: true },
  );

  if (!data) {
    return isPending ? <Skeleton className="size-full" /> : null;
  }

  return (
    <div className="size-full" data-slides-worker-preview>
      <Slides2Canvas className="size-full" flat>
        <SandboxedSlide
          artifact={data as SlideRenderArtifact}
          title={t("agent.slideNumber", { number: slide.slideNumber })}
          onNodes={() => {}}
          onPointer={() => {}}
        />
      </Slides2Canvas>
    </div>
  );
}

function SlidesResultSlidePreview({
  preview,
  workerSlide,
}: {
  preview: SlidesDeckPreview | null;
  workerSlide: WorkerSlidePreview | null;
}) {
  const t = useT();
  if (preview) {
    return (
      <DeckTemplatePreview
        html={preview.content}
        title={t("agent.thisSlide")}
        width={SLIDES_2_CANVAS_WIDTH}
        height={SLIDES_2_CANVAS_HEIGHT}
        stylesheetUrl={slidesStylesheet}
      />
    );
  }
  return workerSlide ? <SlidesWorkerSlidePreview slide={workerSlide} /> : null;
}

function projectSlidesUpdatedSlideResult(context: ToolRendererContext): {
  deckId: string;
  slideId: string;
  position?: number;
  revision?: number;
  sourceHash?: string;
  contentHash?: string;
  updatedAt?: string;
} | null {
  if (!context.resultJson || typeof context.resultJson !== "object") {
    return null;
  }

  const result = context.resultJson as Record<string, unknown>;
  const deckId = typeof result.deckId === "string" ? result.deckId.trim() : "";
  const slideId =
    typeof result.slideId === "string" ? result.slideId.trim() : "";
  if (!deckId || deckId.length > 200 || !slideId || slideId.length > 200) {
    return null;
  }

  if (
    context.toolName === "update-slide-source" ||
    context.toolName === "transform-slide-objects"
  ) {
    const position = result.position;
    if (
      typeof position !== "number" ||
      !Number.isSafeInteger(position) ||
      position < 0 ||
      position >= Number.MAX_SAFE_INTEGER
    ) {
      return null;
    }
    const sourceVersion = projectSourceVersion(result);
    return { deckId, slideId, position, ...sourceVersion };
  }

  if (context.toolName === "update-slide" && result.ok === true) {
    const contentHash =
      typeof result.contentHash === "string" &&
      /^[a-f0-9]{64}$/.test(result.contentHash)
        ? result.contentHash
        : undefined;
    return { deckId, slideId, ...(contentHash ? { contentHash } : {}) };
  }

  if (
    context.toolName === "copy-slide-to-deck" &&
    typeof result.updatedAt === "string" &&
    result.updatedAt.length <= 100 &&
    Array.isArray(result.updatedSlideIds) &&
    result.updatedSlideIds.includes(slideId)
  ) {
    return {
      deckId,
      slideId,
      updatedAt: result.updatedAt,
      ...projectSourceVersion(result),
    };
  }

  return null;
}

function projectSourceVersion(
  value: Record<string, unknown>,
): Pick<WorkerSlidePreview, "revision" | "sourceHash"> | undefined {
  const revision = value.revision;
  const sourceHash = value.sourceHash;
  if (
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    typeof sourceHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(sourceHash)
  ) {
    return undefined;
  }
  return { revision, sourceHash };
}

function projectLayoutFitContentHash(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const layoutFit = (value as Record<string, unknown>).layoutFit;
  if (!layoutFit || typeof layoutFit !== "object" || Array.isArray(layoutFit)) {
    return undefined;
  }
  const contentHash = (layoutFit as Record<string, unknown>).contentHash;
  return typeof contentHash === "string" && /^[a-f0-9]{64}$/.test(contentHash)
    ? contentHash
    : undefined;
}

function projectTemplateCopyDeckResult(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const result = value as Record<string, unknown>;
  const templateId =
    typeof result.templateId === "string" ? result.templateId.trim() : "";
  if (
    !templateId ||
    templateId.length > 100 ||
    typeof result.reused !== "boolean"
  ) {
    return null;
  }

  return projectSlidesDeckResult({
    id: result.id,
    title: result.title,
    slideCount: result.slideCount,
  });
}

type SlidesPatchDeckResult = {
  deckId: string;
  updatedAt: string;
  updatedSlideIds: string[];
  deletedSlideIds: string[];
};

function SlidesGenericToolResult({ context }: ToolRendererProps) {
  const result =
    context.resultText ?? JSON.stringify(context.resultJson, null, 2) ?? "";
  return (
    <ToolCallDisplay
      toolName="result"
      args={context.args}
      result={result}
      isRunning={context.isRunning}
    />
  );
}

function projectSlidesPatchDeckResult(
  context: ToolRendererContext,
): SlidesPatchDeckResult | null {
  if (
    context.toolName !== "patch-deck" ||
    !context.resultJson ||
    typeof context.resultJson !== "object" ||
    Array.isArray(context.resultJson)
  ) {
    return null;
  }

  const result = context.resultJson as Record<string, unknown>;
  const deckId = typeof result.deckId === "string" ? result.deckId.trim() : "";
  if (
    result.ok !== true ||
    result.applied === false ||
    !deckId ||
    deckId.length > 200 ||
    /[\s\u0000-\u001f\u007f]/u.test(deckId) ||
    typeof result.updatedAt !== "string" ||
    result.updatedAt.length === 0 ||
    result.updatedAt.length > 100 ||
    !Array.isArray(result.updatedSlideIds) ||
    !Array.isArray(result.deletedSlideIds) ||
    result.updatedSlideIds.length > 200 ||
    result.deletedSlideIds.length > 200
  ) {
    return null;
  }

  const projectSlideIds = (values: unknown[]): string[] | null => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      if (
        typeof value !== "string" ||
        value.length === 0 ||
        value.length > 200 ||
        value !== value.trim() ||
        /[\s\u0000-\u001f\u007f]/u.test(value)
      ) {
        return null;
      }
      if (!seen.has(value)) ids.push(value);
      seen.add(value);
    }
    return ids;
  };

  const updatedSlideIds = projectSlideIds(result.updatedSlideIds);
  const deletedSlideIds = projectSlideIds(result.deletedSlideIds);
  if (!updatedSlideIds || !deletedSlideIds) return null;

  return {
    deckId,
    updatedAt: result.updatedAt,
    updatedSlideIds,
    deletedSlideIds,
  };
}

export function SlidesDeckResultCard({ context }: ToolRendererProps) {
  const t = useT();
  const isTemplateCopy = context.toolName === "create-deck-from-template";
  const templateCopy = isTemplateCopy
    ? projectTemplateCopyDeckResult(context.resultJson)
    : null;
  const deck = isTemplateCopy
    ? templateCopy
    : projectSlidesDeckResult(context.resultJson);
  const needsFallbackRead = Boolean(
    deck &&
    deck.slideCount > deck.previews.length &&
    deck.previews.length < MAX_DECK_RESULT_PREVIEWS,
  );
  const deckRead = useActionQuery(
    "get-deck",
    { id: deck?.id ?? "", compact: "false" },
    {
      enabled: needsFallbackRead,
    },
  );
  if (!deck) return <SlidesGenericToolResult context={context} />;
  const readDeck =
    deckRead.data &&
    typeof deckRead.data === "object" &&
    !Array.isArray(deckRead.data) &&
    (deckRead.data as Record<string, unknown>).id === deck.id
      ? (deckRead.data as Record<string, unknown>)
      : null;
  if (isTemplateCopy && !readDeck && !deckRead.isPending) {
    return <SlidesGenericToolResult context={context} />;
  }
  const chatParams = new URLSearchParams({ deckId: deck.id });
  const sourceVersions = projectSourceVersionsBySlideId(context.resultJson);
  const previews = projectDeckResultPreviews(
    isTemplateCopy
      ? (readDeck ?? context.resultJson)
      : (deckRead.data ?? context.resultJson),
    deck.id,
    deck.previews,
    sourceVersions,
  );
  const showPreviewLoading =
    needsFallbackRead &&
    deckRead.isPending &&
    previews.length < MAX_DECK_RESULT_PREVIEWS;
  const originalPrompt =
    projectOriginalPrompt(context.args) ??
    projectOriginalPromptFromGenerationContext(
      deckRead.data?.generationContext,
    );

  return (
    <div className="space-y-3">
      <ActionCard
        icon={<IconPresentation aria-hidden="true" />}
        title={deck.title}
        detail={t("history.slideCount", { count: deck.slideCount })}
        status={t("deckResult.saved")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to={`/deck/${encodeURIComponent(deck.id)}`}>
                {t("deckEditor.applyResult")}
              </Link>
            </Button>
            {!templateCopy ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  submitSlidesRegeneration({
                    deckId: deck.id,
                    deckTitle: deck.title,
                    originalPrompt,
                  })
                }
              >
                {t("deckEditor.regenerateResult")}
              </Button>
            ) : null}
            <Button asChild size="sm" variant="outline">
              <Link to={`/chat?${chatParams.toString()}`}>
                {t("deckEditor.continueInChat")}
              </Link>
            </Button>
          </div>
        }
      />
      {previews.length > 0 || showPreviewLoading ? (
        <div
          className="mt-3 grid grid-cols-3 gap-2 overflow-hidden"
          data-slides-deck-preview-strip
          inert
          aria-hidden="true"
        >
          {previews.map((preview) => (
            <div
              key={
                preview.kind === "html"
                  ? preview.slide.id
                  : preview.slide.slideId
              }
              className="relative aspect-video min-w-0 overflow-hidden rounded-md border border-border bg-muted"
            >
              {preview.kind === "html" ? (
                <DeckTemplatePreview
                  html={preview.slide.content}
                  title={t("agent.thisSlide")}
                  width={SLIDES_2_CANVAS_WIDTH}
                  height={SLIDES_2_CANVAS_HEIGHT}
                  stylesheetUrl={slidesStylesheet}
                />
              ) : (
                <SlidesWorkerSlidePreview slide={preview.slide} />
              )}
            </div>
          ))}
          {showPreviewLoading ? (
            <div className="aspect-video overflow-hidden rounded-md border border-border bg-muted p-2">
              <Skeleton className="size-full" />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

registerActionChatRenderer({
  id: "slides.deck-result",
  renderer: SLIDES_DECK_RESULT_RENDERER,
  Component: SlidesDeckResultCard,
});

registerToolRenderer({
  id: "slides.template-copy-result",
  match: (context) => context.toolName === "create-deck-from-template",
  Component: SlidesDeckResultCard,
});

export function SlidesPatchedDeckResultCard({ context }: ToolRendererProps) {
  const t = useT();
  const result = projectSlidesPatchDeckResult(context);
  const deckRead = useActionQuery(
    "get-deck",
    { id: result?.deckId ?? "", compact: "false" },
    { enabled: result !== null },
  );

  if (!result) return <SlidesGenericToolResult context={context} />;

  const responseDeck =
    deckRead.data &&
    typeof deckRead.data === "object" &&
    !Array.isArray(deckRead.data)
      ? (deckRead.data as Record<string, unknown>)
      : null;
  const deck =
    responseDeck?.id === result.deckId &&
    responseDeck.updatedAt === result.updatedAt
      ? responseDeck
      : null;
  if (!deck) return <SlidesGenericToolResult context={context} />;
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  const previewIds = result.updatedSlideIds.filter(
    (slideId) => !result.deletedSlideIds.includes(slideId),
  );
  const updatedSlides = previewIds
    .map((slideId) =>
      slides.find(
        (slide) =>
          slide &&
          typeof slide === "object" &&
          !Array.isArray(slide) &&
          (slide as Record<string, unknown>).id === slideId,
      ),
    )
    .filter((slide) => slide !== undefined);
  const previewDeck =
    deck && updatedSlides.length > 0
      ? { ...deck, slides: updatedSlides }
      : null;
  const projectedDeck = previewDeck
    ? projectSlidesDeckResult(previewDeck)
    : null;
  const previews =
    previewDeck && projectedDeck
      ? projectDeckResultPreviews(
          previewDeck,
          result.deckId,
          projectedDeck.previews,
          projectSourceVersionsBySlideId(previewDeck),
        )
      : [];
  const deckTitle =
    typeof deck?.title === "string" && deck.title.trim()
      ? deck.title.trim().slice(0, 180)
      : result.deckId;
  const detail =
    typeof deck?.slideCount === "number" &&
    Number.isSafeInteger(deck.slideCount) &&
    deck.slideCount >= 0
      ? t("history.slideCount", { count: deck.slideCount })
      : undefined;
  const chatParams = new URLSearchParams({ deckId: result.deckId });

  return (
    <div className="space-y-3">
      <ActionCard
        icon={<IconPresentation aria-hidden="true" />}
        title={deckTitle}
        detail={detail}
        status={t("deckResult.saved")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to={`/deck/${encodeURIComponent(result.deckId)}`}>
                {t("deckEditor.applyResult")}
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to={`/chat?${chatParams.toString()}`}>
                {t("deckEditor.continueInChat")}
              </Link>
            </Button>
          </div>
        }
      />
      {previews.length > 0 ? (
        <div
          className="mt-3 grid grid-cols-3 gap-2 overflow-hidden"
          data-slides-patch-deck-preview
          inert
          aria-hidden="true"
        >
          {previews.map((preview) => (
            <div
              key={
                preview.kind === "html"
                  ? preview.slide.id
                  : preview.slide.slideId
              }
              className="relative aspect-video min-w-0 overflow-hidden rounded-md border border-border bg-muted"
            >
              {preview.kind === "html" ? (
                <DeckTemplatePreview
                  html={preview.slide.content}
                  title={t("agent.thisSlide")}
                  width={SLIDES_2_CANVAS_WIDTH}
                  height={SLIDES_2_CANVAS_HEIGHT}
                  stylesheetUrl={slidesStylesheet}
                />
              ) : (
                <SlidesWorkerSlidePreview slide={preview.slide} />
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

registerToolRenderer({
  id: "slides.patch-deck-result",
  match: (context) => context.toolName === "patch-deck",
  Component: SlidesPatchedDeckResultCard,
});

export function SlidesViewScreenResultCard({ context }: ToolRendererProps) {
  const t = useT();
  const result = projectSlidesViewScreenResult(context.resultJson);
  const { data, isPending } = useActionQuery(
    "get-deck",
    {
      id: result?.deckId ?? "",
      slideId: result?.slideId ?? "",
      compact: "false",
    },
    { enabled: result !== null },
  );

  if (!result) return null;

  const responseDeck =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  const deck = responseDeck?.id === result.deckId ? responseDeck : null;
  const expectedVersion =
    result.revision !== undefined && result.sourceHash !== undefined
      ? { revision: result.revision, sourceHash: result.sourceHash }
      : undefined;
  const workerSlide =
    deck && expectedVersion
      ? findWorkerSlidePreview(deck, result.deckId, result.slideId, {
          revision: expectedVersion.revision,
          sourceHash: expectedVersion.sourceHash,
        })
      : null;
  const contentHash = result.contentHash;
  const legacySlide =
    deck && contentHash && Array.isArray(deck.slides)
      ? deck.slides.find(
          (slide) =>
            slide &&
            typeof slide === "object" &&
            !Array.isArray(slide) &&
            (slide as Record<string, unknown>).id === result.slideId,
        )
      : undefined;
  const legacySlideData =
    legacySlide &&
    typeof legacySlide === "object" &&
    !Array.isArray(legacySlide)
      ? (legacySlide as Record<string, unknown>)
      : null;
  const preview =
    deck &&
    contentHash &&
    legacySlideData &&
    !isSourceBackedSlide(legacySlideData) &&
    legacySlideData.contentHash === contentHash
      ? projectSlidesAddedSlidePreview(deck, result.slideId)
      : null;
  const savedSlideNumber = legacySlideData?.slideNumber;
  const slideNumber =
    workerSlide?.slideNumber ??
    (typeof savedSlideNumber === "number" &&
    Number.isSafeInteger(savedSlideNumber) &&
    savedSlideNumber > 0
      ? savedSlideNumber
      : result.slideNumber);
  const deckTitle =
    typeof deck?.title === "string" && deck.title.trim()
      ? deck.title.trim().slice(0, 180)
      : t("agent.thisSlide");
  const deckUrl = `/deck/${encodeURIComponent(result.deckId)}?slide=${slideNumber}`;

  return (
    <div className="space-y-3">
      <ActionCard
        icon={<IconPresentation aria-hidden="true" />}
        title={deckTitle}
        detail={t("agent.slideNumber", { number: slideNumber })}
        status={t("agent.thisSlide")}
        action={
          <Button asChild size="sm" variant="outline">
            <Link to={deckUrl}>{t("deckEditor.accessApprovalOpenDeck")}</Link>
          </Button>
        }
      />
      {preview || workerSlide ? (
        <div
          className="aspect-video overflow-hidden rounded-md border border-border bg-muted"
          data-slides-view-screen-preview
          inert
          aria-hidden="true"
        >
          <SlidesResultSlidePreview
            preview={preview}
            workerSlide={workerSlide}
          />
        </div>
      ) : isPending ? (
        <div className="aspect-video overflow-hidden rounded-md border border-border bg-muted p-2">
          <Skeleton className="size-full" />
        </div>
      ) : null}
    </div>
  );
}

registerActionChatRenderer({
  id: "slides.view-screen-result",
  renderer: SLIDES_VIEW_SCREEN_RESULT_RENDERER,
  Component: SlidesViewScreenResultCard,
});

export function SlidesAddedSlideResultCard({ context }: ToolRendererProps) {
  const t = useT();
  const result = projectSlidesAddedSlideResult(context.resultJson);
  const { data, isPending } = useActionQuery(
    "get-deck",
    {
      id: result?.deckId ?? "",
      slideId: result?.slideId ?? "",
      compact: "false",
    },
    { enabled: result !== null },
  );

  if (!result) return null;

  const responseDeck =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  const deck = responseDeck?.id === result.deckId ? responseDeck : null;
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  const addedSlide = slides.find(
    (slide) =>
      slide &&
      typeof slide === "object" &&
      !Array.isArray(slide) &&
      (slide as Record<string, unknown>).id === result.slideId,
  ) as Record<string, unknown> | undefined;
  const savedSlideNumber = addedSlide?.slideNumber;
  const slideNumber =
    typeof savedSlideNumber === "number" &&
    Number.isSafeInteger(savedSlideNumber) &&
    savedSlideNumber >= 1
      ? savedSlideNumber
      : result.slideNumber;
  const expectedVersion =
    result.revision !== undefined && result.sourceHash !== undefined
      ? { revision: result.revision, sourceHash: result.sourceHash }
      : undefined;
  const resultContentHash = projectLayoutFitContentHash(context.resultJson);
  const legacyContentHashMatchesRead =
    resultContentHash !== undefined &&
    addedSlide?.contentHash === resultContentHash;
  const sourceBacked = isSourceBackedSlide(addedSlide);
  const sourceVersionMatchesRead =
    expectedVersion === undefined
      ? !sourceBacked && legacyContentHashMatchesRead
      : addedSlide?.revision === expectedVersion.revision &&
        addedSlide?.sourceHash === expectedVersion.sourceHash;
  const workerSlide =
    sourceBacked && expectedVersion
      ? findWorkerSlidePreview(
          deck,
          result.deckId,
          result.slideId,
          expectedVersion,
        )
      : null;
  const preview =
    sourceVersionMatchesRead && !workerSlide
      ? projectSlidesAddedSlidePreview(deck, result.slideId)
      : null;
  const originalPrompt =
    projectOriginalPrompt(context.args) ??
    projectOriginalPromptFromGenerationContext(deck?.generationContext);
  const chatParams = new URLSearchParams({
    deckId: result.deckId,
    slideId: result.slideId,
    slideNumber: String(slideNumber),
  });

  return (
    <div className="space-y-3">
      <ActionCard
        icon={<IconPresentation aria-hidden="true" />}
        title={result.deckTitle}
        detail={t("agent.slideNumber", { number: slideNumber })}
        status={t("deckResult.saved")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link
                to={`/deck/${encodeURIComponent(result.deckId)}?slide=${slideNumber}`}
              >
                {t("deckEditor.applyResult")}
              </Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                submitSlidesRegeneration({
                  deckId: result.deckId,
                  deckTitle: result.deckTitle,
                  slideId: result.slideId,
                  slideNumber,
                  originalPrompt,
                })
              }
            >
              {t("deckEditor.regenerateResult")}
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to={`/chat?${chatParams.toString()}`}>
                {t("deckEditor.continueInChat")}
              </Link>
            </Button>
          </div>
        }
      />
      {preview || workerSlide ? (
        <div
          className="aspect-video overflow-hidden rounded-md border border-border bg-muted"
          data-slides-added-slide-preview
          inert
          aria-hidden="true"
        >
          <SlidesResultSlidePreview
            preview={preview}
            workerSlide={workerSlide}
          />
        </div>
      ) : isPending ? (
        <div className="aspect-video overflow-hidden rounded-md border border-border bg-muted p-2">
          <Skeleton className="size-full" />
        </div>
      ) : null}
    </div>
  );
}

registerActionChatRenderer({
  id: "slides.added-slide-result",
  renderer: SLIDES_ADDED_SLIDE_RESULT_RENDERER,
  Component: SlidesAddedSlideResultCard,
});

export function SlidesUpdatedSlideResultCard({ context }: ToolRendererProps) {
  const t = useT();
  const result = projectSlidesUpdatedSlideResult(context);
  const { data, isPending } = useActionQuery(
    "get-deck",
    {
      id: result?.deckId ?? "",
      slideId: result?.slideId ?? "",
      compact: "false",
    },
    { enabled: result !== null },
  );

  if (!result) return null;

  const responseDeck =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  const deck = responseDeck?.id === result.deckId ? responseDeck : null;
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  const updatedSlide = slides.find(
    (slide) =>
      slide &&
      typeof slide === "object" &&
      !Array.isArray(slide) &&
      (slide as Record<string, unknown>).id === result.slideId,
  ) as Record<string, unknown> | undefined;
  const queriedSlideNumber = updatedSlide?.slideNumber;
  const slideNumber =
    typeof queriedSlideNumber === "number" &&
    Number.isSafeInteger(queriedSlideNumber) &&
    queriedSlideNumber >= 1
      ? queriedSlideNumber
      : result.position === undefined
        ? undefined
        : isPending
          ? result.position + 1
          : undefined;
  const deckTitle =
    typeof deck?.title === "string" && deck.title.trim()
      ? deck.title.trim().slice(0, 180)
      : t("agent.thisSlide");
  const expectedVersion =
    result.revision === undefined || result.sourceHash === undefined
      ? undefined
      : { revision: result.revision, sourceHash: result.sourceHash };
  const sourceBacked = isSourceBackedSlide(updatedSlide);
  const legacyContentHashMatchesRead =
    result.contentHash !== undefined &&
    updatedSlide?.contentHash === result.contentHash;
  const sourceVersionMatchesRead =
    expectedVersion === undefined
      ? !sourceBacked &&
        (context.toolName !== "update-slide" || legacyContentHashMatchesRead) &&
        (context.toolName !== "copy-slide-to-deck" ||
          (result.updatedAt !== undefined &&
            deck?.updatedAt === result.updatedAt))
      : updatedSlide?.revision === expectedVersion.revision &&
        updatedSlide?.sourceHash === expectedVersion.sourceHash;
  const workerSlide =
    sourceBacked && expectedVersion
      ? findWorkerSlidePreview(
          deck,
          result.deckId,
          result.slideId,
          expectedVersion,
        )
      : null;
  const preview =
    sourceVersionMatchesRead && !workerSlide
      ? projectSlidesAddedSlidePreview(deck, result.slideId)
      : null;
  const chatParams = new URLSearchParams({
    deckId: result.deckId,
    slideId: result.slideId,
    ...(slideNumber === undefined ? {} : { slideNumber: String(slideNumber) }),
  });
  const deckUrl = slideNumber
    ? `/deck/${encodeURIComponent(result.deckId)}?slide=${slideNumber}`
    : `/deck/${encodeURIComponent(result.deckId)}`;
  const originalPrompt =
    projectOriginalPrompt(context.args) ??
    projectOriginalPromptFromGenerationContext(deck?.generationContext);

  return (
    <div className="space-y-3">
      <ActionCard
        icon={<IconPresentation aria-hidden="true" />}
        title={deckTitle}
        detail={
          slideNumber === undefined
            ? undefined
            : t("agent.slideNumber", { number: slideNumber })
        }
        status={t("deckResult.saved")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to={deckUrl}>{t("deckEditor.applyResult")}</Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                submitSlidesRegeneration({
                  deckId: result.deckId,
                  deckTitle,
                  slideId: result.slideId,
                  slideNumber,
                  originalPrompt,
                })
              }
            >
              {t("deckEditor.regenerateResult")}
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to={`/chat?${chatParams.toString()}`}>
                {t("deckEditor.continueInChat")}
              </Link>
            </Button>
          </div>
        }
      />
      {preview || workerSlide ? (
        <div
          className="aspect-video overflow-hidden rounded-md border border-border bg-muted"
          data-slides-updated-slide-preview
          inert
          aria-hidden="true"
        >
          <SlidesResultSlidePreview
            preview={preview}
            workerSlide={workerSlide}
          />
        </div>
      ) : isPending ? (
        <div className="aspect-video overflow-hidden rounded-md border border-border bg-muted p-2">
          <Skeleton className="size-full" />
        </div>
      ) : null}
    </div>
  );
}

registerToolRenderer({
  id: "slides.updated-slide-result",
  match: (context) =>
    context.toolName === "update-slide" ||
    context.toolName === "update-slide-source" ||
    context.toolName === "transform-slide-objects" ||
    context.toolName === "copy-slide-to-deck",
  Component: SlidesUpdatedSlideResultCard,
});
