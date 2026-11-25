import { useT } from "@agent-native/core/client/i18n";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  IconArrowsMinimize,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconMinus,
  IconPlus,
} from "@tabler/icons-react";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";

function imageDownloadName(src: string, alt: string): string {
  const cleanAlt = alt.trim().replace(/[^a-z0-9._-]+/gi, "-");
  if (cleanAlt) return cleanAlt.toLowerCase();

  try {
    const pathname = new URL(src).pathname;
    const name = pathname.split("/").filter(Boolean).pop();
    if (name) return decodeURIComponent(name);
    // coercion-ok: a src that isn't a full URL just gets the default name.
  } catch {}

  return "image";
}

export async function downloadImage(
  src: string,
  alt: string,
  copy: {
    started: string;
    opened: string;
  },
) {
  const filename = imageDownloadName(src, alt);

  try {
    const response = await fetch(src);
    if (!response.ok) throw new Error("Download failed");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast.success(copy.started);
  } catch {
    const anchor = document.createElement("a");
    anchor.href = src;
    anchor.download = filename;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    toast.info(copy.opened);
  }
}

const pageImageFocus = new WeakMap<
  HTMLImageElement,
  (image: HTMLImageElement) => void
>();

export function usePageImage(focusImage: (image: HTMLImageElement) => void) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!image) return;
    pageImageFocus.set(image, focusImage);
    return () => {
      pageImageFocus.delete(image);
    };
  }, [image, focusImage]);

  return [image, setImage] as const;
}

interface Gallery {
  images: { element: HTMLImageElement; src: string; alt: string }[];
  index: number;
}

const CLOSED_TOGGLE = ".content-toggle:not(.content-toggle--open)";

function readGallery(origin: HTMLImageElement | null | undefined) {
  const page = origin?.closest(".ProseMirror");
  if (!origin || !page) return null;
  const elements = Array.from(page.querySelectorAll("img")).filter(
    (image) => pageImageFocus.has(image) && !image.closest(CLOSED_TOGGLE),
  );
  const index = elements.indexOf(origin);
  if (index < 0 || elements.length < 2) return null;
  const images = elements.map((element) => ({
    element,
    src: element.getAttribute("src") ?? "",
    alt: element.alt,
  }));
  return { images, index } satisfies Gallery;
}

function stepGallery(gallery: Gallery | null, offset: number) {
  if (!gallery) return gallery;
  const index = gallery.index + offset;
  if (index < 0 || index >= gallery.images.length) return gallery;
  return { ...gallery, index };
}

function arrowOffset(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
    return 0;
  if (event.key === "ArrowLeft") return -1;
  if (event.key === "ArrowRight") return 1;
  return 0;
}

export function ImageLightbox({
  open,
  onOpenChange,
  src,
  alt,
  returnFocus,
  origin,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt: string;
  returnFocus?: HTMLElement | null;
  origin?: HTMLImageElement | null;
}) {
  const t = useT();
  const [zoomed, setZoomed] = useState(false);
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const shown = gallery?.images[gallery.index];
  const shownSrc = shown?.src ?? src;
  const shownAlt = shown?.alt ?? alt;
  const hasGallery = Boolean(gallery);

  useEffect(() => {
    if (!open) setZoomed(false);
  }, [open]);

  useLayoutEffect(() => {
    if (open) setGallery(readGallery(origin));
  }, [open, origin]);

  useEffect(() => {
    if (!gallery) return;
    const neighbours = gallery.images.filter(
      (_, index) => Math.abs(index - gallery.index) === 1,
    );
    for (const neighbour of neighbours) new Image().src = neighbour.src;
  }, [gallery]);

  useEffect(() => {
    if (!open || !hasGallery) return;
    function stepOnArrow(event: KeyboardEvent) {
      const offset = arrowOffset(event);
      if (!offset) return;
      event.preventDefault();
      setGallery((current) => stepGallery(current, offset));
    }
    document.addEventListener("keydown", stepOnArrow);
    return () => document.removeEventListener("keydown", stepOnArrow);
  }, [open, hasGallery]);

  function step(offset: number) {
    setGallery((current) => stepGallery(current, offset));
  }

  function handleViewportPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const image = imageRef.current;
    if (!image) return;

    const imageRect = image.getBoundingClientRect();
    const rootFontSize = Number.parseFloat(
      window.getComputedStyle(document.documentElement).fontSize,
    );
    const closeBuffer = 4 * (Number.isFinite(rootFontSize) ? rootFontSize : 16);
    const isFarOutsideImage =
      event.clientX < imageRect.left - closeBuffer ||
      event.clientX > imageRect.right + closeBuffer ||
      event.clientY < imageRect.top - closeBuffer ||
      event.clientY > imageRect.bottom + closeBuffer;

    if (isFarOutsideImage) {
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="media-lightbox__overlay" />
        <DialogPrimitive.Content
          ref={contentRef}
          className="media-lightbox"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            contentRef.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            const image = shown?.element ?? origin;
            const focusImage = image?.isConnected
              ? pageImageFocus.get(image)
              : undefined;
            if (image && focusImage) {
              event.preventDefault();
              focusImage(image);
              return;
            }
            if (!returnFocus?.isConnected) return;
            event.preventDefault();
            returnFocus.focus();
          }}
        >
          <DialogTitle className="sr-only">
            {t("editor.media.imagePreview")}
          </DialogTitle>
          <div
            className="media-lightbox__viewport"
            onPointerDown={handleViewportPointerDown}
          >
            <button
              type="button"
              className="media-lightbox__image-button"
              data-zoomed={zoomed ? "true" : undefined}
              aria-label={
                zoomed
                  ? t("editor.media.zoomImageOut")
                  : t("editor.media.zoomImageIn")
              }
              aria-pressed={zoomed}
              onClick={() => setZoomed((current) => !current)}
            >
              <img
                ref={imageRef}
                src={shownSrc}
                alt={shownAlt}
                className="media-lightbox__image"
                draggable={false}
              />
            </button>
          </div>

          <div
            className="media-lightbox__toolbar"
            aria-label={t("editor.media.imageView")}
          >
            {gallery ? (
              <>
                <button
                  type="button"
                  className="media-lightbox__toolbar-btn"
                  aria-label={t("editor.media.previousImage")}
                  disabled={gallery.index === 0}
                  onClick={() => step(-1)}
                >
                  <IconChevronLeft size={17} />
                </button>
                <span className="media-lightbox__position" role="status">
                  {t("editor.media.imagePosition", {
                    current: gallery.index + 1,
                    total: gallery.images.length,
                  })}
                </span>
                <button
                  type="button"
                  className="media-lightbox__toolbar-btn"
                  aria-label={t("editor.media.nextImage")}
                  disabled={gallery.index === gallery.images.length - 1}
                  onClick={() => step(1)}
                >
                  <IconChevronRight size={17} />
                </button>
                <span className="media-lightbox__separator" aria-hidden />
              </>
            ) : null}
            <button
              type="button"
              className="media-lightbox__toolbar-btn"
              aria-label={t("editor.media.zoomOut")}
              disabled={!zoomed}
              onClick={() => setZoomed(false)}
            >
              <IconMinus size={17} />
            </button>
            <span className="media-lightbox__zoom-value">
              {zoomed ? "150%" : "100%"}
            </span>
            <button
              type="button"
              className="media-lightbox__toolbar-btn"
              aria-label={t("editor.media.zoomIn")}
              disabled={zoomed}
              onClick={() => setZoomed(true)}
            >
              <IconPlus size={17} />
            </button>
            <span className="media-lightbox__separator" aria-hidden />
            <button
              type="button"
              className="media-lightbox__toolbar-btn"
              aria-label={t("editor.media.downloadImage")}
              onClick={() =>
                void downloadImage(shownSrc, shownAlt, {
                  started: t("editor.media.imageDownloadStarted"),
                  opened: t("editor.media.openedImageInNewTab"),
                })
              }
            >
              <IconDownload size={17} />
            </button>
            <span className="media-lightbox__separator" aria-hidden />
            <button
              type="button"
              className="media-lightbox__toolbar-btn"
              aria-label={t("editor.media.closeImagePreview")}
              onClick={() => onOpenChange(false)}
            >
              <IconArrowsMinimize size={17} />
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
