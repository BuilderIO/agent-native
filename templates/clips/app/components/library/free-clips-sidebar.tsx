import { useT } from "@agent-native/core/client/i18n";
import { IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { trackFreeClipsOffer } from "@/components/recorder/use-builder-storage-activation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  useVideoStorageStatus,
  type VideoStorageStatus,
} from "@/hooks/use-video-storage-status";

import { BuilderOfferDialog, BuilderOfferHero } from "./builder-offer";

const OFFER_MINIMIZED_KEY = "clips:builder-offer-minimized";

/**
 * When the Builder.io offer replaces the free clips count: on the last free
 * clip, when intent is shown and the limit is real, and again once they are
 * used up. Dismissing it brings the count back until the next of these.
 */
export type BuilderOfferMilestone = "last_clip" | "used_up";

export function builderOfferMilestone(
  used: number,
  limit: number,
): BuilderOfferMilestone | null {
  const remaining = limit - used;
  if (limit <= 0) return null;
  if (remaining <= 0) return "used_up";
  if (remaining === 1) return "last_clip";
  return null;
}

/** Free hosted clips used so far, or null when the allowance doesn't apply. */
export function freeClipsUsage(
  status: VideoStorageStatus | undefined,
): { used: number; limit: number } | null {
  if (!status || status.hostedLimit <= 0) return null;
  const applies =
    status.mode === "hosted" ||
    (status.mode === "none" && status.denyReason === "exhausted");
  if (!applies) return null;
  return {
    used: Math.max(0, status.hostedLimit - status.hostedRemaining),
    limit: status.hostedLimit,
  };
}

function readMinimizedMilestone(): string | null {
  try {
    return window.localStorage.getItem(OFFER_MINIMIZED_KEY);
    // coercion-ok: an unreadable store shows the offer again, which is harmless
  } catch {
    return null;
  }
}

function writeMinimizedMilestone(milestone: BuilderOfferMilestone): void {
  try {
    window.localStorage.setItem(OFFER_MINIMIZED_KEY, milestone);
    // coercion-ok: a blocked store only means the offer shows again next visit
  } catch {
    // A blocked store only means the offer shows again next visit.
  }
}

export function FreeClipsSidebar() {
  const t = useT();
  const storage = useVideoStorageStatus();
  const usage = freeClipsUsage(storage.data);
  const [minimized, setMinimized] = useState(readMinimizedMilestone);
  const [dialogOpen, setDialogOpen] = useState(false);
  const milestone = usage
    ? builderOfferMilestone(usage.used, usage.limit)
    : null;
  const showOffer = milestone !== null && milestone !== minimized;
  const remaining = usage ? Math.max(0, usage.limit - usage.used) : 0;
  const limit = usage?.limit ?? 0;

  useEffect(() => {
    if (!showOffer) return;
    trackFreeClipsOffer("clips_free_clips_offer_viewed", {
      surface: "sidebar_card",
      milestone,
      remaining,
      limit,
    });
  }, [showOffer, milestone, remaining, limit]);

  if (!usage) return null;

  return (
    <div className="px-2 pb-2">
      {showOffer ? (
        <Card className="group relative flex flex-col rounded-[14px] border border-border p-2 shadow-xs">
          <BuilderOfferHero
            size="card"
            className="rounded-[10px] border border-border"
          />
          <div className="flex flex-col gap-0.5 px-2 pt-3">
            <p className="text-sm font-semibold leading-5 text-foreground">
              {milestone === "used_up"
                ? t("freeClips.offerTitleUsedUp")
                : t("freeClips.offerTitleLastClip")}
            </p>
            <p className="text-[13px] leading-[18px] text-muted-foreground">
              {milestone === "used_up"
                ? t("freeClips.offerDescriptionUsedUp")
                : t("freeClips.offerDescriptionLastClip")}
            </p>
          </div>
          <div className="relative z-10 flex px-2 pb-1 pt-2">
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="flex h-6 items-center rounded-sm text-[13px] font-medium leading-4 text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("freeClips.offerAction")}
            </button>
          </div>
          {/* The rest of the card opens the offer too; the button above is its keyboard target. */}
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={() => setDialogOpen(true)}
            className="absolute inset-0 rounded-[14px]"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t("freeClips.offerDismiss")}
            className="absolute -end-2 -top-2 z-10 size-7 rounded-full bg-background opacity-0 shadow-sm transition-opacity focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
            onClick={() => {
              trackFreeClipsOffer("clips_free_clips_offer_dismissed", {
                surface: "sidebar_card",
                milestone,
                remaining,
                limit,
              });
              writeMinimizedMilestone(milestone);
              setMinimized(milestone);
            }}
          >
            <IconX className="size-4" aria-hidden />
          </Button>
        </Card>
      ) : (
        <Card className="flex flex-col gap-2 rounded-[14px] border border-border p-3 shadow-xs">
          <span className="flex w-full items-start justify-between text-xs leading-4">
            <span className="font-medium text-foreground">
              {t("freeClips.badgeTitle")}
            </span>
            <span className="text-muted-foreground">
              {t("freeClips.badgeCount", {
                remaining,
                limit: usage.limit,
              })}
            </span>
          </span>
          <Progress
            value={(remaining / usage.limit) * 100}
            aria-label={t("freeClips.badgeTitle")}
            getValueLabel={() =>
              t("freeClips.badgeCount", { remaining, limit: usage.limit })
            }
            className="h-1 rounded-[2px] bg-muted [&>div]:rounded-[2px]"
          />
        </Card>
      )}
      {dialogOpen ? (
        <BuilderOfferDialog
          open
          onOpenChange={setDialogOpen}
          source="clips_sidebar_free_clips"
          milestone={milestone ?? "count"}
          remaining={remaining}
          limit={limit}
        />
      ) : null}
    </div>
  );
}
