import { callAction, useActionMutation } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { isSourceRuntimeExportError } from "@shared/source-runtime-export";
import {
  IconBrandGoogle,
  IconCode,
  IconDownload,
  IconFileTypePdf,
  IconPhoto,
} from "@tabler/icons-react";
import { forwardRef, useCallback, useImperativeHandle, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { getAspectRatioDims, type AspectRatio } from "@/lib/aspect-ratios";
import { exportDeckAsPdf, type PdfExportSlide } from "@/lib/export-pdf-client";
import {
  buildDeckPptxBlob,
  exportDeckAsImagePptx,
  exportDeckAsPptx,
} from "@/lib/export-pptx-client";
import { sanitizeSlideHtml } from "@/lib/sanitize-slide-html";

import {
  isSlideRenderArtifact,
  type SlideDesignTokens,
  type SlideRenderArtifact,
} from "../slides-2-runtime/protocol";
import { renderSlideArtifactInSandbox } from "../slides-2-runtime/SandboxedSlide";
import { getEditorExportErrorTranslationKey } from "./editor-export-errors";

export type Slides2ExportFormat =
  | "html"
  | "pdf"
  | "pptx"
  | "pptx-images"
  | "google-slides";

export type Slides2ExportMenuHandle = {
  run: (format: Slides2ExportFormat) => Promise<void>;
};

type SlideSummary = {
  id: string;
  notes?: string | null;
};

type ExportDeckSlide = {
  id: string;
  sourceTsx?: string | null;
  content?: string | null;
  notes?: string | null;
};

type ExportDeckSnapshot = {
  slides: ExportDeckSlide[];
};

type Props = {
  deckId: string;
  title: string;
  slides: SlideSummary[];
  aspectRatio?: AspectRatio;
  onBeforeExport: () => Promise<boolean>;
};

type HtmlExportResult = {
  html: string;
  filename: string;
};

type DownloadExportResult = {
  downloadUrl: string;
  filename: string;
  googleSlidesImportUrl?: string;
};

type ExportStatus =
  | { state: "exporting"; format: Slides2ExportFormat }
  | { state: "error"; message: string }
  | { state: "google-slides-ready"; importUrl: string }
  | null;

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function triggerUrlDownload(url: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function applyDesignTokens(
  element: HTMLElement,
  tokens: SlideDesignTokens | undefined,
) {
  if (!tokens) return;
  element.style.backgroundColor = tokens.background;
  element.style.color = tokens.text;
  element.style.setProperty("--deck-bg", tokens.background);
  element.style.setProperty("--deck-ink", tokens.text);
  element.style.setProperty("--deck-accent", tokens.accent);
  element.style.setProperty("--deck-heading-font", tokens.displayFont);
  element.style.setProperty("--deck-body-font", tokens.bodyFont);
  element.style.setProperty("--deck-hero-scale", String(tokens.heroScale));
  element.style.setProperty("--deck-body-scale", String(tokens.bodyScale));
  element.style.setProperty("--deck-radius", `${tokens.radius}px`);
}

function applySlides2Design(
  element: HTMLElement,
  design: NonNullable<SlideRenderArtifact["runtime"]>["design"],
) {
  if (!design) return;
  element.style.setProperty("--slides2-bg", design.palette.bg);
  element.style.setProperty("--slides2-text", design.palette.text);
  element.style.setProperty("--slides2-accent", design.palette.accent);
  element.style.setProperty("--slides2-font-display", design.fonts.display);
  element.style.setProperty("--slides2-font-body", design.fonts.body);
  element.style.setProperty(
    "--slides2-size-hero",
    `${design.typeScale.hero}px`,
  );
  element.style.setProperty(
    "--slides2-size-body",
    `${design.typeScale.body}px`,
  );
  element.style.setProperty("--slides2-radius", `${design.radius}px`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isExportDeckSnapshot(value: unknown): value is ExportDeckSnapshot {
  if (!isRecord(value) || !Array.isArray(value.slides)) return false;
  return value.slides.every(
    (slide) =>
      isRecord(slide) &&
      typeof slide.id === "string" &&
      (slide.sourceTsx === undefined ||
        slide.sourceTsx === null ||
        typeof slide.sourceTsx === "string") &&
      (slide.content === undefined ||
        slide.content === null ||
        typeof slide.content === "string") &&
      (slide.notes === undefined ||
        slide.notes === null ||
        typeof slide.notes === "string"),
  );
}

async function loadDeckSlidesForExport(
  deckId: string,
  slides: SlideSummary[],
): Promise<Array<{ summary: SlideSummary; stored: ExportDeckSlide }>> {
  if (slides.length === 0) return [];
  if (new Set(slides.map((slide) => slide.id)).size !== slides.length) {
    throw new Error("invalid-export-slide-order");
  }

  const snapshot = await callAction<unknown>(
    "get-deck",
    {
      id: deckId,
      slideIds: slides.map((slide) => slide.id),
      compact: "false",
    },
    { method: "GET" },
  );
  if (!isExportDeckSnapshot(snapshot)) {
    throw new Error("invalid-export-deck-snapshot");
  }
  if (snapshot.slides.length !== slides.length) {
    throw new Error("incomplete-export-deck-snapshot");
  }

  const slidesById = new Map<string, ExportDeckSlide>();
  for (const slide of snapshot.slides) {
    if (slidesById.has(slide.id)) throw new Error("duplicate-export-slide-id");
    slidesById.set(slide.id, slide);
  }

  return slides.map((summary) => {
    const stored = slidesById.get(summary.id);
    if (!stored) throw new Error("missing-export-slide");
    return { summary, stored };
  });
}

async function renderSlidesForExport(
  deckId: string,
  slides: SlideSummary[],
  aspectRatio?: AspectRatio,
): Promise<{ stage: HTMLDivElement; exportSlides: PdfExportSlide[] }> {
  const storedSlides = await loadDeckSlidesForExport(deckId, slides);
  const defaultDimensions = getAspectRatioDims(aspectRatio);
  const stage = document.createElement("div");
  stage.dataset.pdfExportStage = "true";
  stage.setAttribute("aria-hidden", "true");
  Object.assign(stage.style, {
    position: "fixed",
    left: "-20000px",
    top: "0",
    width: "1920px",
    pointerEvents: "none",
  });

  const exportSlides: PdfExportSlide[] = [];
  for (const { summary, stored } of storedSlides) {
    const pdfSlideRoot = String(exportSlides.length);
    const sourceTsx = stored.sourceTsx;
    const hasSource =
      typeof sourceTsx === "string" && Boolean(sourceTsx.trim());
    let html: string;
    let styles: string[];
    let design: NonNullable<SlideRenderArtifact["runtime"]>["design"];
    let designTokens: SlideDesignTokens | undefined;
    let assetOrigins: string[];
    let width: number;
    let height: number;
    if (hasSource) {
      const artifact = await callAction<SlideRenderArtifact>(
        "get-slide-render",
        { deckId, slideId: summary.id },
        { method: "GET" },
      );
      if (
        !isSlideRenderArtifact(artifact, window.location.origin) ||
        artifact.deckId !== deckId ||
        artifact.slideId !== summary.id
      ) {
        throw new Error("invalid-slide-render-artifact");
      }

      const rendered = artifact.runtime
        ? await renderSlideArtifactInSandbox(
            artifact,
            window.location.origin,
            500,
          )
        : {
            html: artifact.html,
            styles: [],
            design: undefined,
            designTokens: artifact.designTokens,
            assetOrigins: artifact.assetOrigins ?? [],
          };
      html = rendered.html;
      styles = rendered.styles;
      design = rendered.design;
      designTokens = rendered.designTokens;
      assetOrigins = rendered.assetOrigins;
      width = artifact.width;
      height = artifact.height;
    } else {
      if (
        stored.sourceTsx !== undefined &&
        stored.sourceTsx !== null &&
        typeof stored.sourceTsx !== "string"
      ) {
        throw new Error("invalid-export-slide-source");
      }
      if (
        stored.content !== undefined &&
        stored.content !== null &&
        typeof stored.content !== "string"
      ) {
        throw new Error("invalid-export-slide-content");
      }
      html = sanitizeSlideHtml(stored.content ?? "", {
        scopeSelector: `[data-pdf-slide-root="${pdfSlideRoot}"]`,
      });
      styles = [];
      design = undefined;
      designTokens = undefined;
      assetOrigins = [];
      width = defaultDimensions.width;
      height = defaultDimensions.height;
    }

    const canvas = document.createElement("div");
    canvas.dataset.slideCanvas = summary.id;
    canvas.dataset.pdfSlideRoot = pdfSlideRoot;
    canvas.style.position = "relative";
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.overflow = "hidden";
    applyDesignTokens(canvas, designTokens);
    applySlides2Design(canvas, design);

    for (const css of styles) {
      const style = document.createElement("style");
      style.textContent = css.replaceAll(
        "#slide-root",
        `[data-pdf-slide-root="${pdfSlideRoot}"]`,
      );
      canvas.append(style);
    }

    const template = document.createElement("template");
    template.innerHTML = html;
    const allowedAssetOrigins = new Set(assetOrigins);
    for (const image of template.content.querySelectorAll<HTMLImageElement>(
      "img[src]",
    )) {
      const src = image.getAttribute("src");
      if (!src) continue;
      const url = new URL(src, window.location.href);
      if (
        !hasSource &&
        url.protocol === "https:" &&
        url.origin !== window.location.origin
      ) {
        allowedAssetOrigins.add(url.origin);
      }
      if (
        (url.protocol !== "https:" && url.origin !== window.location.origin) ||
        (url.origin !== window.location.origin &&
          !allowedAssetOrigins.has(url.origin))
      ) {
        throw new Error("unsafe-slide-asset-origin");
      }
    }
    canvas.append(template.content);
    stage.append(canvas);
    const notes = summary.notes ?? stored.notes;
    exportSlides.push({
      id: summary.id,
      content: html,
      ...(notes ? { notes } : {}),
    });
  }

  document.body.append(stage);
  return { stage, exportSlides };
}

function toPptxExportSlides(
  slides: PdfExportSlide[],
): Array<{ id: string; notes?: string }> {
  return slides.map(({ id, notes }) => ({
    id,
    ...(notes ? { notes } : {}),
  }));
}

export const Slides2ExportMenu = forwardRef<Slides2ExportMenuHandle, Props>(
  function Slides2ExportMenu(
    { deckId, title, slides, aspectRatio, onBeforeExport },
    ref,
  ) {
    const t = useT();
    const exportHtml = useActionMutation<HtmlExportResult, { deckId: string }>(
      "export-html",
    );
    const exportPptx = useActionMutation<
      DownloadExportResult,
      { deckId: string }
    >("export-pptx");
    const exportGoogleSlides = useActionMutation<
      DownloadExportResult,
      { deckId: string }
    >("export-google-slides");
    const [status, setStatus] = useState<ExportStatus>(null);

    const run = useCallback(
      async (format: Slides2ExportFormat) => {
        if (status?.state === "exporting" || slides.length === 0) return;
        setStatus({ state: "exporting", format });
        try {
          if (!(await onBeforeExport())) {
            setStatus(null);
            return;
          }
          if (format === "html") {
            const result = await exportHtml.mutateAsync({ deckId });
            triggerBlobDownload(
              new Blob([result.html], { type: "text/html;charset=utf-8" }),
              result.filename,
            );
            setStatus(null);
            return;
          }
          if (format === "pptx") {
            try {
              const result = await exportPptx.mutateAsync({ deckId });
              triggerUrlDownload(result.downloadUrl, result.filename);
            } catch (error) {
              if (!isSourceRuntimeExportError(error)) throw error;
              const { stage, exportSlides } = await renderSlidesForExport(
                deckId,
                slides,
                aspectRatio,
              );
              try {
                await exportDeckAsPptx(
                  title,
                  toPptxExportSlides(exportSlides),
                  aspectRatio,
                  { deckId },
                );
              } finally {
                stage.remove();
              }
            }
            setStatus(null);
            return;
          }
          if (format === "pptx-images") {
            const { stage, exportSlides } = await renderSlidesForExport(
              deckId,
              slides,
              aspectRatio,
            );
            try {
              await exportDeckAsImagePptx(
                title,
                toPptxExportSlides(exportSlides),
                aspectRatio,
                { deckId },
                stage,
              );
            } finally {
              stage.remove();
            }
            setStatus(null);
            return;
          }
          if (format === "google-slides") {
            let result: DownloadExportResult;
            try {
              result = await exportGoogleSlides.mutateAsync({ deckId });
            } catch (error) {
              if (!isSourceRuntimeExportError(error)) throw error;
              const { stage, exportSlides } = await renderSlidesForExport(
                deckId,
                slides,
                aspectRatio,
              );
              try {
                const built = await buildDeckPptxBlob(
                  title,
                  toPptxExportSlides(exportSlides),
                  aspectRatio,
                  { target: "google-slides" },
                );
                triggerBlobDownload(built.blob, built.filename);
              } finally {
                stage.remove();
              }
              setStatus({
                state: "google-slides-ready",
                importUrl:
                  "https://docs.google.com/presentation/u/0/?usp=import",
              });
              return;
            }
            triggerUrlDownload(result.downloadUrl, result.filename);
            setStatus({
              state: "google-slides-ready",
              importUrl:
                result.googleSlidesImportUrl ??
                "https://docs.google.com/presentation/u/0/?usp=import",
            });
            return;
          }

          const { stage, exportSlides } = await renderSlidesForExport(
            deckId,
            slides,
            aspectRatio,
          );
          try {
            await exportDeckAsPdf(title, exportSlides, aspectRatio);
          } finally {
            stage.remove();
          }
          setStatus(null);
        } catch (error) {
          const actionError = error as { details?: unknown } | null | undefined;
          const details = actionError?.details;
          const slideNumber =
            details && typeof details === "object" && "slideNumber" in details
              ? details.slideNumber
              : undefined;
          const errorTranslationKey = getEditorExportErrorTranslationKey(error);
          const message =
            errorTranslationKey === "editorExport.pptxImageUnavailable" &&
            typeof slideNumber === "number" &&
            Number.isInteger(slideNumber) &&
            slideNumber > 0
              ? t(errorTranslationKey, { slideNumber })
              : errorTranslationKey === "editorExport.pptxImageUnavailable"
                ? t("editorExport.exportFailed")
                : t(errorTranslationKey);
          setStatus({
            state: "error",
            message,
          });
        }
      },
      [
        aspectRatio,
        deckId,
        exportGoogleSlides,
        exportHtml,
        exportPptx,
        onBeforeExport,
        slides,
        status?.state,
        t,
        title,
      ],
    );

    useImperativeHandle(ref, () => ({ run }), [run]);

    const formatLabel =
      status?.state === "exporting"
        ? status.format === "html"
          ? t("editorExport.downloadHtml")
          : status.format === "pdf"
            ? t("editorExport.exportPdf")
            : status.format === "pptx"
              ? t("editorExport.exportPptx")
              : status.format === "pptx-images"
                ? t("editorExport.exportPptxAsImages")
                : t("editorExport.openInGoogleSlides")
        : null;

    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={slides.length === 0 || status?.state === "exporting"}
            >
              <IconDownload className="me-1 size-4" aria-hidden="true" />
              {t("editorExport.export")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => void run("html")}>
              <IconCode className="me-2 size-4" aria-hidden="true" />
              {t("editorExport.downloadHtml")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void run("pdf")}>
              <IconFileTypePdf className="me-2 size-4" aria-hidden="true" />
              {t("editorExport.exportPdf")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void run("pptx")}>
              <IconDownload className="me-2 size-4" aria-hidden="true" />
              {t("editorExport.exportPptx")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void run("pptx-images")}>
              <IconPhoto className="me-2 size-4" aria-hidden="true" />
              {t("editorExport.exportPptxAsImages")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void run("google-slides")}>
              <IconBrandGoogle className="me-2 size-4" aria-hidden="true" />
              {t("editorExport.openInGoogleSlides")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Dialog
          open={status !== null}
          onOpenChange={(open) => {
            if (!open && status?.state !== "exporting") setStatus(null);
          }}
        >
          <DialogContent hideClose={status?.state === "exporting"}>
            {status?.state === "exporting" ? (
              <>
                <DialogHeader>
                  <DialogTitle>{t("editorExport.exporting")}</DialogTitle>
                  <DialogDescription>{formatLabel}</DialogDescription>
                </DialogHeader>
                <div
                  className="flex items-center gap-3 py-2"
                  aria-live="polite"
                >
                  <Spinner className="size-5" />
                  <span className="text-sm text-muted-foreground">
                    {t("editorExport.exporting")}
                  </span>
                </div>
              </>
            ) : status?.state === "error" ? (
              <>
                <DialogHeader>
                  <DialogTitle>{t("editorExport.exportFailed")}</DialogTitle>
                  <DialogDescription className="break-words">
                    {status.message}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button type="button" onClick={() => setStatus(null)}>
                    {t("comments.close")}
                  </Button>
                </DialogFooter>
              </>
            ) : status?.state === "google-slides-ready" ? (
              <>
                <DialogHeader>
                  <DialogTitle>
                    {t("editorExport.googleSlidesDownloaded")}
                  </DialogTitle>
                  <DialogDescription>
                    {t("editorExport.googleSlidesImportHint")}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    type="button"
                    onClick={() =>
                      window.open(
                        status.importUrl,
                        "_blank",
                        "noopener,noreferrer",
                      )
                    }
                  >
                    {t("editorExport.googleSlidesOpenImporter")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStatus(null)}
                  >
                    {t("comments.close")}
                  </Button>
                </DialogFooter>
              </>
            ) : null}
          </DialogContent>
        </Dialog>
      </>
    );
  },
);
