/**
 * The deck source carried inside an exported PDF's XMP metadata stream.
 *
 * A PDF page is a picture of a slide, not the slide: even a vector export
 * loses the object tree the editor edits, and our page raster loses the text
 * with it. Carrying the original slide HTML alongside the render is what lets
 * `import-file` hand back the exact editable deck instead of a reconstruction
 * — the same trick Illustrator and Keynote use to make their own PDFs
 * reopenable. Foreign PDFs have no sidecar and still go through
 * `parsePdfFidelity`.
 */

/**
 * XMP namespace URI the exporter stamps and the importer matches on. Bump the
 * trailing version segment only for a breaking payload change: an importer
 * that does not recognise the namespace falls through to fidelity parsing,
 * which is the correct degrade for a payload it cannot read.
 */
export const SLIDES_PDF_SIDECAR_NAMESPACE =
  "https://agent-native.com/ns/slides-deck/1.0/";

/** The transition values a slide record accepts; validated on the way back in. */
export const SIDECAR_TRANSITIONS = [
  "instant",
  "none",
  "fade",
  "slide",
  "zoom",
] as const;

export type SlideTransition = (typeof SIDECAR_TRANSITIONS)[number];

/** The reveal steps a slide can carry, as the editor stores them. */
export interface SlidesPdfSidecarAnimation {
  id: string;
  elementIndex: number;
  elementPath?: number[];
  type: "appear" | "fade" | "slide-up" | "zoom";
}

/**
 * One slide, carried whole — with one deliberate omission. Everything the
 * editor stores about how a slide *looks* travels, because dropping
 * animations, transitions, or an Excalidraw scene would make the restore
 * another partial reconstruction. Speaker notes do not: a PDF is the artifact
 * people forward, and notes are private commentary the page never shows.
 * `toSharedDeckSlide` already blanks them on every public surface, and
 * PowerPoint and Google Slides both leave them out of a PDF export.
 */
export interface SlidesPdfSidecarSlide {
  content: string;
  layout?: string;
  background?: string;
  imageUrl?: string;
  excalidrawData?: string;
  transition?: SlideTransition;
  splitByParagraph?: boolean;
  skipped?: boolean;
  animations?: SlidesPdfSidecarAnimation[];
}

export interface SlidesPdfSidecar {
  v: 1;
  title?: string;
  aspectRatio?: string;
  slides: SlidesPdfSidecarSlide[];
}

/**
 * Ceiling on the JSON payload before base64. jsPDF writes the metadata stream
 * uncompressed, so a deck that accumulated `data:` image URLs in its slide
 * HTML would otherwise add hundreds of megabytes to the download. Above this
 * the exporter ships the PDF without a sidecar rather than a file nobody can
 * send.
 */
export const SLIDES_PDF_SIDECAR_MAX_JSON_BYTES = 4_000_000;

/** Bytes of base64 that decode to `SLIDES_PDF_SIDECAR_MAX_JSON_BYTES`, so both sides police the same budget. */
export const SLIDES_PDF_SIDECAR_MAX_BASE64_BYTES = Math.ceil(
  (SLIDES_PDF_SIDECAR_MAX_JSON_BYTES * 4) / 3 + 4,
);

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

const ANIMATION_TYPES = ["appear", "fade", "slide-up", "zoom"] as const;

/**
 * Reveal steps address slide children by index and by child-index path, and
 * the editor reads both without re-checking them. An unvalidated blob from an
 * uploaded file would land in `decks.data` and break every consumer that
 * types them.
 */
function isAnimationList(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  return value.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const animation = entry as SlidesPdfSidecarAnimation;
    if (typeof animation.id !== "string") return false;
    if (!Number.isInteger(animation.elementIndex)) return false;
    if (
      animation.elementPath !== undefined &&
      !(
        Array.isArray(animation.elementPath) &&
        animation.elementPath.every((step) => Number.isInteger(step))
      )
    ) {
      return false;
    }
    return (ANIMATION_TYPES as readonly string[]).includes(animation.type);
  });
}

/**
 * Whether a decoded XMP payload is a deck sidecar this build understands. The
 * payload rides inside an uploaded file, so every field the import copies into
 * `decks.data` is checked here — a `title` that is an object or a `layout` that
 * is an array would otherwise be typed as a string everywhere downstream.
 */
export function isSlidesPdfSidecar(value: unknown): value is SlidesPdfSidecar {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SlidesPdfSidecar>;
  if (candidate.v !== 1) return false;
  if (!isOptionalString(candidate.title)) return false;
  if (!isOptionalString(candidate.aspectRatio)) return false;
  if (!Array.isArray(candidate.slides)) return false;
  return candidate.slides.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const slide = entry as SlidesPdfSidecarSlide;
    if (typeof slide.content !== "string") return false;
    for (const flag of [slide.splitByParagraph, slide.skipped]) {
      if (flag !== undefined && typeof flag !== "boolean") return false;
    }
    if (!isAnimationList(slide.animations)) return false;
    return (
      isOptionalString(slide.layout) &&
      isOptionalString(slide.background) &&
      isOptionalString(slide.imageUrl) &&
      isOptionalString(slide.excalidrawData) &&
      (slide.transition === undefined ||
        (SIDECAR_TRANSITIONS as readonly string[]).includes(slide.transition))
    );
  });
}
