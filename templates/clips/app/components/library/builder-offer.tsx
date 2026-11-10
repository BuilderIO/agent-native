import { appPath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import { IconCheck } from "@tabler/icons-react";
import { useEffect, useRef, type CSSProperties } from "react";

import { BuilderActivationAction } from "@/components/recorder/builder-activation-action";
import {
  trackFreeClipsOffer,
  useBuilderStorageActivation,
} from "@/components/recorder/use-builder-storage-activation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const HERO_SIZES = {
  card: {
    height: "h-28",
    meld: "/builder-card/meld.svg",
    meldBox: "left-[-70px] top-[-47px] h-[211px] w-[379px]",
    gap: "gap-[15px]",
    tile: "size-9 rounded-[6.4px] border-[0.64px] shadow-sm",
    builder: { width: 11.39, height: 12.86 },
    agentNative: { width: 18, height: 10.5 },
    relay: { dot: "size-[3.86px]", gap: "gap-[5.14px]" },
  },
  dialog: {
    // 224px, not the design's 288px, so the offer fits a laptop screen.
    height: "h-56",
    meld: "/builder-card/meld-dialog.svg",
    meldBox: "left-[-168px] top-[-146px] h-[531px] w-[924px]",
    gap: "gap-[34px]",
    tile: "size-20 rounded-[14.3px] border-[1.43px] shadow-md",
    builder: { width: 25.31, height: 28.57 },
    agentNative: { width: 40, height: 23.33 },
    relay: { dot: "size-[8.57px]", gap: "gap-[11.43px]" },
  },
} as const;

/** The Builder.io and Agent-Native tiles on the blue and teal wash. */
export function BuilderOfferHero({
  size,
  busy = false,
  className,
}: {
  size: keyof typeof HERO_SIZES;
  /** Carries the dots twice as fast while the account is being set up. */
  busy?: boolean;
  className?: string;
}) {
  const s = HERO_SIZES[size];
  return (
    <div
      aria-hidden
      className={cn(
        "relative w-full shrink-0 overflow-hidden bg-background",
        s.height,
        className,
      )}
    >
      <img
        alt=""
        src={appPath(s.meld)}
        className={cn("absolute max-w-none", s.meldBox)}
      />
      <div
        className="absolute inset-0 bg-background opacity-70"
        style={maskStyle("/builder-card/fade-mask.svg")}
      />
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center",
          s.gap,
        )}
      >
        <BrandTile
          className={s.tile}
          mark="/builder-card/builder-mark.svg"
          {...s.builder}
        />
        <span className={cn("flex items-center", s.relay.gap)}>
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className={cn(
                "rounded-full motion-safe:animate-[clips-relay-dot_var(--relay-loop)_ease-in-out_infinite]",
                s.relay.dot,
                index === 1 ? "bg-builder-blue" : "bg-muted-foreground",
              )}
              style={
                {
                  "--relay-loop": busy ? "0.9s" : "1.8s",
                  animationDelay: `${index * (busy ? 0.15 : 0.3)}s`,
                } as CSSProperties
              }
            />
          ))}
        </span>
        <BrandTile
          className={s.tile}
          mark="/builder-card/agent-native-mark.svg"
          {...s.agentNative}
        />
      </div>
    </div>
  );
}

function maskStyle(path: string) {
  const url = `url("${appPath(path)}")`;
  return {
    maskImage: url,
    maskSize: "100% 100%",
    WebkitMaskImage: url,
    WebkitMaskSize: "100% 100%",
  };
}

/** The mark follows the text color, so it paints through its SVG as a mask. */
export function BrandMark({
  mark,
  width,
  height,
  className,
}: {
  mark: string;
  width: number;
  height: number;
  className?: string;
}) {
  return (
    <span
      className={cn("block bg-foreground", className)}
      style={{ width, height, ...maskStyle(mark) }}
    />
  );
}

function BrandTile({
  className,
  ...mark
}: {
  className: string;
  mark: string;
  width: number;
  height: number;
}) {
  return (
    <span
      className={cn(
        "flex items-center justify-center border-border bg-background",
        className,
      )}
    >
      <BrandMark {...mark} />
    </span>
  );
}

const CHECKS = [
  "freeClips.offerCheckRecording",
  "freeClips.offerCheckTranscripts",
  "freeClips.offerCheckSummaries",
] as const;

export function BuilderOfferDialog({
  open,
  onOpenChange,
  source,
  milestone,
  remaining,
  limit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: string;
  milestone: string;
  remaining: number;
  limit: number;
}) {
  const t = useT();
  const activation = useBuilderStorageActivation({
    source,
    flow: `free_clips_${milestone}`,
  });
  const offer = {
    surface: "offer_dialog" as const,
    milestone,
    remaining,
    limit,
  };
  const offerRef = useRef(offer);
  offerRef.current = offer;
  useEffect(() => {
    trackFreeClipsOffer("clips_free_clips_offer_viewed", offerRef.current);
  }, []);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && activation.state !== "connected") {
          trackFreeClipsOffer("clips_free_clips_offer_dismissed", offer);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-[560px] gap-0 overflow-hidden p-0">
        <BuilderOfferHero
          size="dialog"
          busy={
            activation.state === "creating" || activation.state === "finishing"
          }
          className="border-b border-border"
        />
        <div className="flex flex-col gap-6 p-8">
          <div className="flex flex-col gap-2">
            <DialogTitle className="text-2xl font-semibold leading-8 tracking-[-0.02em]">
              {milestone === "last_clip"
                ? t("freeClips.offerTitleLastClip")
                : t("freeClips.offerTitleUsedUp")}
            </DialogTitle>
            <DialogDescription className="text-sm leading-5">
              {t("freeClips.offerDialogDescription")}
            </DialogDescription>
          </div>
          <ul className="flex flex-col gap-3">
            {CHECKS.map((key) => (
              <li key={key} className="flex items-center gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center">
                  {/* Tabler's check is inset in its box; 16px matches the design's 14px mark. */}
                  <IconCheck
                    className="size-4 text-success"
                    stroke={2.25}
                    aria-hidden
                  />
                </span>
                <span className="text-sm leading-5 text-foreground">
                  {t(key)}
                </span>
              </li>
            ))}
          </ul>
          <BuilderActivationAction
            activation={activation}
            label={t("freeClips.offerDialogAction")}
            className="pt-2"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
