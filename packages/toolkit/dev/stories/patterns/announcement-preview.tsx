import { IconArrowUpRight, IconCheck } from "@tabler/icons-react";
import { useCallback, useRef, useState } from "react";

import { Button, ButtonLink } from "../../../src/ui/base-ui/button.js";
import {
  Dialog,
  DialogTrigger,
  DialogBody,
  DialogHeader,
  DialogMedia,
  DialogFooter,
  DialogPopup,
  DialogClose,
  DialogDescription,
  DialogTitle,
} from "../../../src/ui/base-ui/dialog.js";
import { Heading } from "../../../src/ui/base-ui/heading.js";
import {
  ImageCardActions,
  ImageCardBody,
  ImageCard,
  ImageCardMedia,
  ImageCardTarget,
} from "../../../src/ui/base-ui/image-card.js";
import { Link } from "../../../src/ui/base-ui/link.js";
import { Text } from "../../../src/ui/base-ui/text.js";

export const featureUrl = "https://assets.agent-native.com/library";
const cover = new URL(
  "../../../../../templates/assets/public/library-presets/prismatic-paper-cut/kirigami.webp",
  import.meta.url,
).href;
const film = new URL("./media/paper-studies.mp4", import.meta.url).href;
const compactCover = new URL(
  "../../../../../templates/assets/public/library-presets/prismatic-paper-cut/paper-rainbow.webp",
  import.meta.url,
).href;

interface AnnouncementPreviewProps {
  featureHref?: string;
  media?: "image" | "video" | "none";
}

export function AnnouncementPreview({
  media = "image",
  featureHref = featureUrl,
}: AnnouncementPreviewProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const portal = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const [played, setPlayed] = useState(false);
  const playbackPosition = useRef(0);
  const attachPlayer = useCallback((node: HTMLVideoElement | null) => {
    player.current = node;
    if (!node) {
      playbackPosition.current = 0;
      setPlayed(false);
    }
  }, []);
  function changeOpen(next: boolean) {
    setOpen(next);
    const video = player.current;
    if (!video) return;
    if (!next) {
      video.pause();
      playbackPosition.current = video.currentTime;
    }
    if (playbackPosition.current > 0)
      video.currentTime = playbackPosition.current;
  }
  const featureLink = {
    href: featureHref,
    target: "_blank",
    rel: "noopener",
    "aria-label": "Explore styles (opens in a new tab)",
  };
  const hasMedia = media !== "none";
  const artwork = (
    <picture>
      <source media="(max-width: 480px)" srcSet={compactCover} />
      <img
        src={cover}
        alt="Layered cut-paper artwork from the style library"
        width={800}
        height={400}
        loading="lazy"
        decoding="async"
      />
    </picture>
  );
  return (
    <div ref={portal} className="max-w-80">
      <Dialog open={open} onOpenChange={changeOpen}>
        <ImageCard>
          {hasMedia && <ImageCardMedia>{artwork}</ImageCardMedia>}
          <ImageCardBody>
            <Heading as="h2" textStyle="title-small">
              <ImageCardTarget render={<DialogTrigger />}>
                Meet the style library
              </ImageCardTarget>
            </Heading>
            <Text as="p" textStyle="body" className="text-fg-muted">
              Start with a visual style and make it your own.
            </Text>
            <ImageCardActions>
              <Link
                {...featureLink}
                color="gray"
                className="inline-flex items-center gap-1"
              >
                Explore styles{" "}
                <IconArrowUpRight
                  size="var(--control-icon-size-3)"
                  aria-hidden
                />
              </Link>
            </ImageCardActions>
          </ImageCardBody>
        </ImageCard>
        <DialogPopup
          ref={popup}
          initialFocus={() => {
            const panel = popup.current;
            if (!panel || panel.scrollHeight <= panel.clientHeight) return true;
            panel.scrollTop = 0;
            return panel;
          }}
          keepMounted={media === "video" && played}
          closeVariant="solid"
          container={portal}
          closeLabel="Close announcement"
        >
          {hasMedia && (
            <DialogMedia>
              {media === "video" ? (
                <video
                  ref={attachPlayer}
                  controls
                  muted
                  playsInline
                  preload="none"
                  onPlay={() => setPlayed(true)}
                  poster={cover}
                  src={film}
                  aria-label="Paper studies, a silent preview of two cut-paper compositions"
                />
              ) : (
                artwork
              )}
            </DialogMedia>
          )}
          <DialogBody>
            <DialogHeader render={<header />} className="text-start">
              <DialogTitle render={<Heading as="h2" textStyle="title-large" />}>
                Meet the style library
              </DialogTitle>
              <DialogDescription>
                Give your next asset a starting point, from layered paper to
                sculpted clay.
              </DialogDescription>
            </DialogHeader>
            <ul className="my-2 grid gap-3 type-body">
              {[
                "Browse curated visual styles",
                "Keep reference images together",
                "Create a library for your project",
              ].map((item) => (
                <li key={item} className="flex items-center gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-fill-neutral">
                    <IconCheck size="var(--control-icon-size-3)" aria-hidden />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <DialogFooter render={<footer />}>
              <DialogClose render={<Button color="gray" variant="surface" />}>
                Maybe later
              </DialogClose>
              <ButtonLink
                {...featureLink}
                highContrast
                color="gray"
                onClick={() => changeOpen(false)}
              >
                Explore styles
              </ButtonLink>
            </DialogFooter>
          </DialogBody>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
