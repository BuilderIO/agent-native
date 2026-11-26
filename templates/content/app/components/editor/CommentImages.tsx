import { useT } from "@agent-native/core/client/i18n";
import type { CommentImage } from "@shared/comment-images";
import { IconPhotoOff } from "@tabler/icons-react";
import { useState } from "react";

import { ImageLightbox } from "./ImageLightbox";
import { imageDisplaySrc } from "./private-media-src";

export function CommentImages({ images }: { images: readonly CommentImage[] }) {
  const t = useT();
  const [viewing, setViewing] = useState<CommentImage | null>(null);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  if (!images.length) return null;
  return (
    <>
      <ul
        className="mt-1.5 flex flex-wrap gap-1.5"
        aria-label={t("comments.commentImages")}
        data-comment-images
      >
        {images.map((image) => (
          <li key={image.url}>
            <button
              type="button"
              className="flex size-16 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
              aria-label={t("comments.openImage", { name: image.name })}
              title={image.name}
              disabled={failed.has(image.url)}
              onClick={(event) => {
                setOpener(event.currentTarget);
                setViewing(image);
                setOpen(true);
              }}
            >
              {failed.has(image.url) ? (
                <IconPhotoOff size={18} aria-hidden />
              ) : (
                <img
                  src={imageDisplaySrc(image.url)}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className="size-full object-cover"
                  onError={() =>
                    setFailed((current) => new Set(current).add(image.url))
                  }
                />
              )}
            </button>
          </li>
        ))}
      </ul>
      {viewing ? (
        <ImageLightbox
          open={open}
          onOpenChange={setOpen}
          src={imageDisplaySrc(viewing.url)}
          alt={viewing.name}
          returnFocus={opener}
        />
      ) : null}
    </>
  );
}
