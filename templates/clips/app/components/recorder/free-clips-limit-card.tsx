import { useT } from "@agent-native/core/client/i18n";
import { IconVideo, IconX } from "@tabler/icons-react";
import { useEffect } from "react";

import { BrandMark } from "@/components/library/builder-offer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { BuilderActivationAction } from "./builder-activation-action";
import {
  trackFreeClipsOffer,
  useBuilderStorageActivation,
} from "./use-builder-storage-activation";

export interface FreeClipsLimitCardProps {
  limit: number;
  onDismiss: () => void;
  /**
   * `page` stands alone on /record; `popover` sits in a popover anchored to
   * the control that asked to record, so it drops its own chrome.
   */
  variant?: "page" | "popover";
  /**
   * `used_up` once the server refuses another free clip; `last_clip` when the
   * user starts their last one, with a way to go ahead and record it.
   */
  kind?: "used_up" | "last_clip";
  /** For `last_clip`: record the last free clip after all. */
  onProceed?: () => void;
  /** What uses the clip, for the go-ahead button's label. */
  action?: "record" | "upload";
}

export function FreeClipsLimitCard({
  limit,
  onDismiss,
  variant = "page",
  kind = "used_up",
  onProceed,
  action = "record",
}: FreeClipsLimitCardProps) {
  const t = useT();
  const popover = variant === "popover";
  const lastClip = kind === "last_clip";
  const surface = popover ? "library_limit_popover" : "record_limit_card";
  const milestone = lastClip ? "last_clip_intent" : "used_up";
  const remaining = lastClip ? 1 : 0;
  const activation = useBuilderStorageActivation({
    source: popover
      ? `clips_library_free_clips_${action}`
      : "clips_record_free_clips_limit",
    flow: `free_clips_${milestone}`,
  });
  const offer = { surface, milestone, remaining, limit, action } as const;
  useEffect(() => {
    trackFreeClipsOffer("clips_free_clips_offer_viewed", {
      surface,
      milestone,
      remaining,
      limit,
      action,
    });
  }, [action, limit, milestone, remaining, surface]);
  const dismiss = () => {
    trackFreeClipsOffer("clips_free_clips_offer_dismissed", offer);
    onDismiss();
  };
  const proceed = () => {
    trackFreeClipsOffer("clips_free_clips_offer_dismissed", offer);
    onProceed?.();
  };
  return (
    <section
      aria-labelledby="free-clips-limit-title"
      className={cn(
        "flex w-full flex-col",
        !popover &&
          "mx-auto max-w-[400px] overflow-hidden rounded-2xl border border-border bg-card shadow-xl",
      )}
    >
      {popover ? null : (
        <header className="flex items-center justify-between border-b border-border pb-3 pe-3 ps-5 pt-4">
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="flex size-7 items-center justify-center rounded-md bg-primary"
            >
              <BrandMark
                mark="/builder-card/agent-native-mark.svg"
                width={24}
                height={14}
                className="bg-primary-foreground"
              />
            </span>
            <span className="text-sm font-semibold leading-5 text-foreground">
              {t("navigation.brand")}
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("freeClips.limitClose")}
            className="size-7 text-muted-foreground"
            onClick={dismiss}
          >
            <IconX className="size-4" aria-hidden />
          </Button>
        </header>
      )}
      <div
        className={cn(
          "flex flex-col items-center",
          popover ? "gap-4 p-5" : "gap-5 p-7",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "flex items-center justify-center rounded-full bg-muted",
            popover ? "size-14" : "size-[72px]",
          )}
        >
          <IconVideo
            className={cn("text-foreground", popover ? "size-7" : "size-9")}
            stroke={1.5}
          />
        </span>
        <div
          className={cn(
            "flex w-full flex-col text-center",
            popover ? "gap-2" : "gap-2.5",
          )}
        >
          <h2
            id="free-clips-limit-title"
            className={cn(
              "font-bold text-foreground",
              popover ? "text-[15px] leading-[22px]" : "text-lg leading-[26px]",
            )}
          >
            {lastClip
              ? t("freeClips.lastClipTitle")
              : t("freeClips.limitTitle", { count: limit })}
          </h2>
          <p
            className={cn(
              "text-muted-foreground",
              popover ? "text-[13px] leading-5" : "text-sm leading-[22px]",
            )}
          >
            {lastClip
              ? t("freeClips.lastClipDescription")
              : t("freeClips.limitDescription")}
          </p>
        </div>
        <div
          className={cn("flex w-full flex-col", popover ? "gap-2" : "gap-2.5")}
        >
          <BuilderActivationAction
            activation={activation}
            label={
              lastClip
                ? t("freeClips.offerDialogAction")
                : t("freeClips.offerDialogAction")
            }
          />
          {lastClip && onProceed ? (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={proceed}
            >
              {action === "upload"
                ? t("freeClips.lastClipUpload")
                : t("freeClips.lastClipRecord")}
            </Button>
          ) : (
            <button
              type="button"
              className="self-center pt-0.5 text-[13px] font-medium leading-[18px] text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={dismiss}
            >
              {t("freeClips.limitDismiss")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
