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
import {
  projectSlidesAddedSlidePreview,
  projectSlidesAddedSlideResult,
  SLIDES_ADDED_SLIDE_RESULT_RENDERER,
  projectSlidesDeckResult,
  SLIDES_DECK_RESULT_RENDERER,
  type SlidesDeckPreview,
} from "@shared/action-ui";
import { IconPresentation } from "@tabler/icons-react";
import { Link } from "react-router";

import SlideRenderer from "@/components/deck/SlideRenderer";
import type { SlideRenderArtifact } from "@/components/slides-2-runtime/protocol";
import { SandboxedSlide } from "@/components/slides-2-runtime/SandboxedSlide";
import { Slides2Canvas } from "@/components/slides-2-runtime/Slides2Canvas";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Slide } from "@/context/DeckContext";

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
  revision?: number;
  sourceHash?: string;
};

type DeckResultPreview =
  | { kind: "html"; slide: SlidesDeckPreview }
  | { kind: "worker"; slide: WorkerSlidePreview };

function projectWorkerSlidePreview(
  deckId: string,
  slide: unknown,
  slideNumber: number,
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

  const revision = value.revision;
  const sourceHash = value.sourceHash;
  return {
    deckId,
    slideId,
    slideNumber,
    ...(typeof revision === "number" &&
    Number.isSafeInteger(revision) &&
    revision > 0
      ? { revision }
      : {}),
    ...(typeof sourceHash === "string" && /^[a-f0-9]{64}$/.test(sourceHash)
      ? { sourceHash }
      : {}),
  };
}

function projectDeckResultPreviews(
  value: unknown,
  deckId: string,
  htmlPreviews: SlidesDeckPreview[],
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
    const savedHtml = html ?? htmlById.get(rawId || `preview-${index + 1}`);
    if (savedHtml) {
      previews.push({ kind: "html", slide: savedHtml });
    } else {
      const workerSlide = projectWorkerSlidePreview(
        deckId,
        rawSlide,
        index + 1,
      );
      if (workerSlide) previews.push({ kind: "worker", slide: workerSlide });
    }
    if (previews.length >= MAX_DECK_RESULT_PREVIEWS) break;
  }

  return previews.length > 0
    ? previews
    : htmlPreviews.map((slide) => ({ kind: "html", slide }));
}

function findWorkerSlidePreview(
  value: unknown,
  deckId: string,
  slideId: string,
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
  return index < 0
    ? null
    : projectWorkerSlidePreview(deckId, deck.slides[index], index + 1);
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
  if (preview) {
    return (
      <SlideRenderer
        slide={
          {
            id: preview.id,
            content: preview.content,
            notes: "",
            layout: preview.layout,
          } satisfies Slide
        }
        thumbnail
      />
    );
  }
  return workerSlide ? <SlidesWorkerSlidePreview slide={workerSlide} /> : null;
}

function projectSlidesUpdatedSlideResult(
  context: ToolRendererContext,
): { deckId: string; slideId: string; position?: number } | null {
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
    const revision = result.revision;
    const sourceHash = result.sourceHash;
    if (
      typeof position !== "number" ||
      !Number.isSafeInteger(position) ||
      position < 0 ||
      position >= Number.MAX_SAFE_INTEGER ||
      typeof revision !== "number" ||
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      typeof sourceHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(sourceHash)
    ) {
      return null;
    }
    return { deckId, slideId, position };
  }

  if (context.toolName === "update-slide" && result.ok === true) {
    return { deckId, slideId };
  }

  return null;
}

export function SlidesDeckResultCard({ context }: ToolRendererProps) {
  const t = useT();
  const deck = projectSlidesDeckResult(context.resultJson);
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
  if (!deck) return null;
  const chatParams = new URLSearchParams({ deckId: deck.id });
  const previews = projectDeckResultPreviews(
    deckRead.data ?? context.resultJson,
    deck.id,
    deck.previews,
  );
  const showPreviewLoading =
    needsFallbackRead &&
    deckRead.isPending &&
    previews.length < MAX_DECK_RESULT_PREVIEWS;
  const originalPrompt = projectOriginalPrompt(context.args);

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
                <SlideRenderer
                  slide={
                    {
                      id: preview.slide.id,
                      content: preview.slide.content,
                      notes: "",
                      layout: preview.slide.layout,
                    } satisfies Slide
                  }
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

  const preview = projectSlidesAddedSlidePreview(data, result.slideId);
  const workerSlide = preview
    ? null
    : findWorkerSlidePreview(data, result.deckId, result.slideId);
  const originalPrompt = projectOriginalPrompt(context.args);
  const chatParams = new URLSearchParams({
    deckId: result.deckId,
    slideId: result.slideId,
    slideNumber: String(result.slideNumber),
  });

  return (
    <div className="space-y-3">
      <ActionCard
        icon={<IconPresentation aria-hidden="true" />}
        title={result.deckTitle}
        detail={t("agent.slideNumber", { number: result.slideNumber })}
        status={t("deckResult.saved")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link
                to={`/deck/${encodeURIComponent(result.deckId)}?slide=${result.slideNumber}`}
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
                  slideNumber: result.slideNumber,
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
  const preview = projectSlidesAddedSlidePreview(deck, result.slideId);
  const workerSlide = preview
    ? null
    : findWorkerSlidePreview(deck, result.deckId, result.slideId);
  const chatParams = new URLSearchParams({
    deckId: result.deckId,
    slideId: result.slideId,
    ...(slideNumber === undefined ? {} : { slideNumber: String(slideNumber) }),
  });
  const deckUrl = slideNumber
    ? `/deck/${encodeURIComponent(result.deckId)}?slide=${slideNumber}`
    : `/deck/${encodeURIComponent(result.deckId)}`;
  const originalPrompt = projectOriginalPrompt(context.args);

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
    context.toolName === "transform-slide-objects",
  Component: SlidesUpdatedSlideResultCard,
});
