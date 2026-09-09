import type { ReactNode } from "react";
import { Link } from "react-router";

import { BuilderImage } from "../../builder-image";
import { CardArrow } from "./card-arrow";
import { ImgPlaceholder } from "./img-placeholder";

// Text block on top, image/placeholder below — matches builder.io/platform/code's
// key-features card layout. Reused as-is for use-case, key-feature, and
// see-it-in-action cards so all three sections read as one system.
interface ContentCardProps {
  title: ReactNode;
  body?: ReactNode;
  // Real thumbnail — used when one already exists (e.g. the see-it-in-action
  // clips). Falls back to a labeled placeholder box when omitted.
  image?: { src: string; alt: string };
  imageLabel?: string;
  imageAspect?: string;
  // Source frames aren't always cropped the same way as the card's aspect
  // ratio — e.g. the clip thumbnails are square with the subject low in
  // frame, so a plain center crop cuts their face off.
  imageObjectPosition?: string;
  // "bottom" (default) matches the key-features layout: text first, image
  // pinned under it. "top" matches a media-card layout (thumbnail leads,
  // title/body follow) — used for the see-it-in-action video cards.
  imagePosition?: "top" | "bottom";
  href?: string;
  onClick?: () => void;
}

export function ContentCard({
  title,
  body,
  image,
  imageLabel,
  imageAspect = "4 / 3",
  imageObjectPosition = "center",
  imagePosition = "bottom",
  href,
  onClick,
}: ContentCardProps) {
  const textBlock = (
    <div className="flex flex-col gap-[var(--spacing-2)] p-[var(--spacing-8)]">
      <h3 className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-heading-6)] font-medium leading-[1.15] tracking-[-0.02em] text-[var(--b-text-primary)]">
        {title}
      </h3>
      {body ? (
        <div className="m-0 font-[family-name:var(--b-font-sans)] text-[length:var(--b-t-paragraph-2)] leading-[1.4] text-[var(--b-text-secondary)]">
          {body}
        </div>
      ) : null}
      {href ? <CardArrow /> : null}
    </div>
  );

  // No image and no placeholder label means there's no asset yet for this
  // card at all — skip the image area entirely rather than show an empty box.
  const imageBlock = image ? (
    <BuilderImage
      src={image.src}
      alt={image.alt}
      loading="lazy"
      decoding="async"
      className="block w-full object-cover"
      style={{ aspectRatio: imageAspect, objectPosition: imageObjectPosition }}
    />
  ) : imageLabel ? (
    <ImgPlaceholder
      aspectRatio={imageAspect}
      label={imageLabel}
      rounded={false}
      background="var(--b-bg-raised)"
    />
  ) : null;

  const inner =
    !imageBlock || imagePosition === "bottom" ? (
      <>
        {textBlock}
        {/* mt-auto pins the image to the bottom regardless of how tall the
            text block above it is, so every card in a row lines up on the
            same image edge once the grid row stretches them to the tallest
            card. */}
        {imageBlock ? <div className="mt-auto">{imageBlock}</div> : null}
      </>
    ) : (
      <>
        {imageBlock}
        {textBlock}
      </>
    );

  if (!href) {
    return (
      <div className="flex h-full flex-col bg-[var(--b-bg-page)]">{inner}</div>
    );
  }

  const className =
    "group flex h-full flex-col bg-[var(--b-bg-page)] no-underline transition-[background-color] duration-150 hover:bg-[var(--b-bg-raised)]";

  if (href.startsWith("/")) {
    return (
      <Link to={href} className={className} onClick={onClick}>
        {inner}
      </Link>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={onClick}
    >
      {inner}
    </a>
  );
}
