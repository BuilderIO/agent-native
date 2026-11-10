import { useT } from "@agent-native/core/client/i18n";
import {
  cloneElement,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
} from "react";

import { Button } from "@/components/ui/button";
import { useVideoStorageStatus } from "@/hooks/use-video-storage-status";

import { BuilderActivationAction } from "./builder-activation-action";
import {
  lastClipPromptSeen,
  markLastClipPromptSeen,
} from "./free-clips-limit-gate";
import {
  trackFreeClipsOffer,
  useBuilderStorageActivation,
} from "./use-builder-storage-activation";

type StartButton = ReactElement<{
  onClick?: (event: MouseEvent<HTMLElement>) => void;
}>;

/**
 * Wraps a recorder's Start button. The first Start with one free clip left
 * swaps the button for the last-clip prompt in its place, the same block the
 * desktop popover shows, and "Record my last free clip" goes ahead.
 */
export function LastClipStartGate({
  children,
  onStart,
  onOpenChange,
}: {
  children: StartButton;
  onStart: () => void;
  /** So the host can hide its own free clips count while the prompt shows. */
  onOpenChange?: (open: boolean) => void;
}) {
  const storage = useVideoStorageStatus();
  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const status = storage.data;
  const lastClip =
    status?.mode === "hosted" &&
    status.hostedRemaining === 1 &&
    !lastClipPromptSeen();

  if (open && status) {
    return (
      <LastClipPrompt
        limit={status.hostedLimit}
        onRecord={() => {
          setOpen(false);
          onStart();
        }}
      />
    );
  }
  if (!lastClip) return children;
  return cloneElement(children, {
    onClick: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      markLastClipPromptSeen();
      setOpen(true);
    },
  });
}

function LastClipPrompt({
  limit,
  onRecord,
}: {
  limit: number;
  onRecord: () => void;
}) {
  const t = useT();
  const activation = useBuilderStorageActivation({
    source: "clips_record_free_clips_limit",
    flow: "free_clips_last_clip_intent",
  });
  const offer = {
    surface: "record_last_clip_prompt" as const,
    milestone: "last_clip_intent",
    remaining: 1,
    limit,
  };
  const offerRef = useRef(offer);
  offerRef.current = offer;
  useEffect(() => {
    trackFreeClipsOffer("clips_free_clips_offer_viewed", offerRef.current);
  }, []);

  return (
    <section
      aria-labelledby="last-clip-title"
      className="flex w-full flex-col gap-2.5 rounded-lg bg-muted p-3 text-start"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="last-clip-title"
          className="text-sm font-semibold leading-5 text-foreground"
        >
          {t("freeClips.lastClipTitle")}
        </h2>
        <p className="text-[13px] leading-[18px] text-muted-foreground">
          {t("freeClips.lastClipDescription")}
        </p>
      </div>
      <BuilderActivationAction
        activation={activation}
        label={t("freeClips.offerDialogAction")}
        className="gap-2"
      />
      <Button
        type="button"
        variant="outline"
        className="w-full bg-background"
        onClick={() => {
          trackFreeClipsOffer("clips_free_clips_offer_dismissed", offer);
          onRecord();
        }}
      >
        {t("freeClips.lastClipRecord")}
      </Button>
    </section>
  );
}
