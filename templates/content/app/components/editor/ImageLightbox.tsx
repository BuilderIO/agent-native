import { useT } from "@agent-native/core/client/i18n";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  IconArrowsMinimize,
  IconDownload,
  IconMinus,
  IconPlus,
} from "@tabler/icons-react";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
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

/**
 * An image at full size over the page, with zoom and download: the viewer a
 * page's image blocks open, and a comment's images too.
 */
export function ImageLightbox({
  open,
  onOpenChange,
  src,
  alt,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A loadable URL, such as a private image's display path. */
  src: string;
  alt: string;
  /**
   * Where focus goes when the viewer closes, such as the thumbnail that
   * opened it. The viewer has no trigger of its own to hand focus back to.
   */
  returnFocus?: HTMLElement | null;
}) {
  const t = useT();
  const [zoomed, setZoomed] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  // Each opening starts at 100%.
  useEffect(() => {
    if (!open) setZoomed(false);
  }, [open]);

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
      event.clientX > imageRect.right + closeBuffer || // i18n-ignore non-copy geometry expression
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
          className="media-lightbox"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
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
                src={src}
                alt={alt}
                className="media-lightbox__image"
                draggable={false}
              />
            </button>
          </div>

          <div
            className="media-lightbox__toolbar"
            aria-label={t("editor.media.imageView")}
          >
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
                void downloadImage(src, alt, {
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
