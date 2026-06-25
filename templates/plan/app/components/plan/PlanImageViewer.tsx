import { useT } from "@agent-native/core/client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  IconCopy,
  IconDownload,
  IconDots,
  IconExternalLink,
  IconMinus,
  IconPencil,
  IconPhoto,
  IconPlus,
  IconRefresh,
  IconX,
  IconZoomIn,
} from "@tabler/icons-react";
import { useState, type MouseEvent } from "react";

import { Dialog, DialogOverlay, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import {
  copyImage,
  downloadImage,
  type ImageActionMessages,
} from "./image-actions";

/**
 * Shared image presentation for every plan surface — the editor's image node
 * view, the read-only markdown reader, and structured `image` blocks. It renders
 * the image plus a hover toolbar (a zoom button that opens a full-size lightbox
 * and a three-dots menu with swap / download / copy / open) so images behave the
 * same everywhere a plan is viewed or edited.
 *
 * The root is a `<span>` (not a `<div>`) so it stays valid inside the paragraph
 * react-markdown wraps standalone images in — keeping the read/SSR path
 * hydration-safe. Heavy overlays (the lightbox, the dropdown) portal to `body`.
 */
export type PlanImageViewerProps = {
  src: string;
  alt?: string;
  /** Extra classes on the wrapper `<span>`. */
  className?: string;
  /** Extra classes on the `<img>` (sizing / fit / borders per surface). */
  imgClassName?: string;
  loading?: "lazy" | "eager";
  /** Render full-width block layout (structured blocks) vs. intrinsic inline. */
  block?: boolean;
  /**
   * When provided, an "Edit details" item appears in the menu (image blocks wire
   * it to a form for url/alt/caption/fit). Read-only surfaces and inline
   * markdown images omit it.
   */
  onEdit?: () => void;
  /**
   * When provided, a "Replace image" item appears in the menu. The editor wires
   * this to a file picker + re-upload; read-only surfaces omit it.
   */
  onReplace?: () => void;
  /** Force the toolbar visible (e.g. the node is selected in the editor). */
  showControls?: boolean;
  /** Render an uploading / empty placeholder instead of the image. */
  uploading?: boolean;
};

const ACTION_BTN_CLASS =
  "inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:outline-none";

export function PlanImageViewer({
  src,
  alt = "",
  className,
  imgClassName,
  loading = "lazy",
  block = false,
  onEdit,
  onReplace,
  showControls = false,
  uploading = false,
}: PlanImageViewerProps) {
  const t = useT();
  const imageActionMessages = {
    downloadStarted: t("raw.imageActions.downloadStarted"),
    openedNewTab: t("raw.imageActions.openedNewTab"),
    imageCopied: t("raw.imageActions.imageCopied"),
    copiedUrl: t("raw.imageActions.copiedUrl"),
    copyFailed: t("raw.imageActions.copyFailed"),
  };
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  if (uploading || !src) {
    return (
      <span
        className={cn(
          "plan-image-placeholder flex min-h-16 items-center justify-center gap-2 rounded-xl border border-dashed border-plan-line bg-plan-block px-4 py-6 text-sm text-plan-muted",
          block ? "w-full" : "inline-flex max-w-full",
          className,
        )}
      >
        <IconPhoto className="size-5" />
        <span>
          {uploading
            ? t("raw.imageViewer.uploadingImage")
            : alt || t("raw.imageViewer.image")}
        </span>
      </span>
    );
  }

  // Keep the editor from grabbing the selection when the toolbar is clicked.
  function swallowMouseDown(event: MouseEvent) {
    event.preventDefault();
  }

  return (
    <span
      className={cn(
        "plan-image group/plan-image relative align-top",
        block ? "block w-full" : "inline-block max-w-full",
        className,
      )}
    >
      <img
        src={src}
        alt={alt}
        loading={loading}
        draggable={false}
        className={imgClassName}
        onDoubleClick={() => setLightboxOpen(true)}
      />

      <span
        className={cn(
          "plan-image__actions absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-lg border border-border/70 bg-popover/95 p-1 text-popover-foreground shadow-lg backdrop-blur transition-opacity duration-150",
          "opacity-0 group-hover/plan-image:opacity-100 focus-within:opacity-100",
          (showControls || menuOpen) && "opacity-100",
        )}
      >
        <button
          type="button"
          className={ACTION_BTN_CLASS}
          aria-label={t("raw.imageViewer.viewFullSize")}
          title={t("raw.imageViewer.viewFullSize")}
          onMouseDown={swallowMouseDown}
          onClick={() => setLightboxOpen(true)}
        >
          <IconZoomIn size={16} />
        </button>

        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={ACTION_BTN_CLASS}
              aria-label={t("raw.imageViewer.imageOptions")}
              title={t("raw.imageViewer.more")}
            >
              <IconDots size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-44"
            // Don't restore focus to the ⋯ trigger on close: when an item opens
            // a popover/dialog (e.g. "Edit details"), the focus-restore would
            // steal focus from it (dismissing it / breaking its auto-focus).
            onCloseAutoFocus={(event) => event.preventDefault()}
          >
            {onEdit || onReplace ? (
              <>
                {onEdit ? (
                  <DropdownMenuItem onSelect={() => onEdit()}>
                    <IconPencil size={16} className="mr-2" />
                    {t("raw.imageViewer.editDetails")}
                  </DropdownMenuItem>
                ) : null}
                {onReplace ? (
                  <DropdownMenuItem onSelect={() => onReplace()}>
                    <IconRefresh size={16} className="mr-2" />
                    {t("raw.imageViewer.replaceImage")}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuItem
              onSelect={() => void downloadImage(src, alt, imageActionMessages)}
            >
              <IconDownload size={16} className="mr-2" />
              {t("raw.imageViewer.download")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => void copyImage(src, imageActionMessages)}
            >
              <IconCopy size={16} className="mr-2" />
              {t("raw.imageViewer.copyImage")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => window.open(src, "_blank", "noopener,noreferrer")}
            >
              <IconExternalLink size={16} className="mr-2" />
              {t("raw.imageViewer.openOriginal")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>

      <PlanImageLightbox
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        src={src}
        alt={alt}
        actionMessages={imageActionMessages}
      />
    </span>
  );
}

type PlanImageLightboxProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt: string;
  actionMessages?: ImageActionMessages;
};

function PlanImageLightbox({
  open,
  onOpenChange,
  src,
  alt,
  actionMessages,
}: PlanImageLightboxProps) {
  const t = useT();
  const [zoomed, setZoomed] = useState(false);

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) setZoomed(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogOverlay className="z-[250] bg-black/85 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-[251] flex items-center justify-center focus:outline-none"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <DialogTitle className="sr-only">
            {alt || t("raw.imageViewer.closePreview")}
          </DialogTitle>

          <div
            className="flex h-full w-full items-center justify-center overflow-auto p-6"
            onClick={(event) => {
              if (event.target === event.currentTarget) handleOpenChange(false);
            }}
          >
            <img
              src={src}
              alt={alt}
              draggable={false}
              onClick={() => setZoomed((value) => !value)}
              className={cn(
                "rounded-lg shadow-2xl transition-transform",
                zoomed
                  ? "max-w-none cursor-zoom-out"
                  : "max-h-[90vh] max-w-[92vw] cursor-zoom-in object-contain",
              )}
            />
          </div>

          <div className="fixed bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/15 bg-black/70 px-2 py-1.5 text-white shadow-xl backdrop-blur">
            <button
              type="button"
              className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15 disabled:cursor-default disabled:opacity-40"
              aria-label={t("raw.imageViewer.fitToScreen")}
              disabled={!zoomed}
              onClick={() => setZoomed(false)}
            >
              <IconMinus size={17} />
            </button>
            <span className="min-w-[5.5rem] text-center text-xs font-medium tabular-nums">
              {zoomed
                ? t("raw.imageViewer.actualSize")
                : t("raw.imageViewer.fitToScreen")}
            </span>
            <button
              type="button"
              className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15 disabled:cursor-default disabled:opacity-40"
              aria-label={t("raw.imageViewer.actualSize")}
              disabled={zoomed}
              onClick={() => setZoomed(true)}
            >
              <IconPlus size={17} />
            </button>
            <span className="mx-1 h-5 w-px bg-white/20" aria-hidden />
            <button
              type="button"
              className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15"
              aria-label={t("raw.imageViewer.downloadImage")}
              onClick={() => void downloadImage(src, alt, actionMessages)}
            >
              <IconDownload size={17} />
            </button>
            <span className="mx-1 h-5 w-px bg-white/20" aria-hidden />
            <button
              type="button"
              className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15"
              aria-label={t("raw.imageViewer.closePreview")}
              onClick={() => handleOpenChange(false)}
            >
              <IconX size={17} />
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}
