import { useT } from "@agent-native/core/client/i18n";
import type { TextBackground } from "@shared/text-background";
import {
  formatContrastRatio,
  rgbToHex,
  type ContrastFix,
} from "@shared/wcag-contrast";
import {
  IconAlertTriangle,
  IconCheck,
  IconContrast,
} from "@tabler/icons-react";
import { useEffect, useId, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type {
  ContrastMap,
  ContrastReading,
  ContrastUnavailableReason,
} from "./color-picker-contrast-model";

/** What the agent is told when the user hands contrast over to it. */
export interface ContrastAgentRequest {
  /** The ratio now, or null when there is no background to measure against. */
  ratio: number | null;
  /** The WCAG AA ratio for this text size. */
  targetRatio: number;
  large: boolean | null;
  /** The background as hex, when it is known. */
  background: string | null;
  /** The text color as written. */
  foreground: string;
}

/**
 * Contrast for a text layer's solid fill. The picker owns the mode; the
 * caller knows the text and the screen it is on.
 */
export interface DesignColorContrast {
  /** Whether WCAG counts the text as large; null when its size cannot be read. */
  large: boolean | null;
  /** Reads what is behind the text. Never rejects into a color. */
  readBackground: () => Promise<TextBackground>;
  /** Hands the pairing to the agent chat. */
  onAskAgent: (request: ContrastAgentRequest) => void;
}

const UNAVAILABLE_COPY: Record<ContrastUnavailableReason, string> = {
  "no-screen": "editPanel.colorPicker.contrastNoScreen",
  "bad-reply": "editPanel.colorPicker.contrastNoScreen",
  "no-opaque-background": "editPanel.colorPicker.contrastNoBackground",
  image: "editPanel.colorPicker.contrastImage",
  blending: "editPanel.colorPicker.contrastBlending",
  "unreadable-color": "editPanel.colorPicker.contrastUnreadable",
  "text-size": "editPanel.colorPicker.contrastTextSize",
};

/**
 * What is behind the text, read each time contrast mode turns on for an open
 * picker. null while it is being read; a failed read is `unavailable`, never
 * left looking like a background.
 */
export function useTextBackground(
  contrast: DesignColorContrast | undefined,
  enabled: boolean,
): TextBackground | null {
  const [background, setBackground] = useState<TextBackground | null>(null);
  const readRef = useRef(contrast?.readBackground);
  readRef.current = contrast?.readBackground;
  useEffect(() => {
    const read = readRef.current;
    if (!enabled || !read) {
      setBackground(null);
      return;
    }
    let cancelled = false;
    setBackground(null);
    read().then(
      (result) => {
        if (!cancelled) setBackground(result);
      },
      () => {
        if (!cancelled) {
          setBackground({ kind: "unavailable", reason: "no-screen" });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return background;
}

/**
 * The ratio chip and the level it reaches, above the color square. The chip's
 * menu fixes the color for AA or AAA, or asks the agent to.
 */
export function ContrastBar({
  reading,
  foreground,
  disabled,
  previewFix,
  onFix,
  onAskAgent,
}: {
  reading: ContrastReading;
  /** The text color as shown to the user, for the chip's tooltip. */
  foreground: string;
  disabled: boolean;
  /** What a fix for this ratio would do; called only while the menu is open. */
  previewFix: (target: number) => ContrastFix;
  onFix: (target: number) => void;
  onAskAgent: () => void;
}) {
  const t = useT();
  const ready = reading.kind === "ready" ? reading : null;
  const backgroundHex = ready ? rgbToHex(ready.background) : null;
  return (
    <div className="flex h-6 items-center justify-between gap-2 px-3 mt-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            title={
              ready && backgroundHex
                ? t("editPanel.colorPicker.contrastPair", {
                    foreground,
                    background: backgroundHex,
                  })
                : reading.kind === "unavailable"
                  ? t(UNAVAILABLE_COPY[reading.reason])
                  : undefined
            }
            aria-label={
              ready
                ? t("editPanel.colorPicker.contrastChipLabel", {
                    ratio: formatContrastRatio(ready.ratio),
                  })
                : t("editPanel.colorPicker.contrast")
            }
            className={cn(
              "flex h-6 min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 !text-[11px] tabular-nums transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              ready
                ? "bg-primary/10 text-primary hover:bg-primary/15"
                : "bg-[var(--design-editor-control-bg)] text-muted-foreground hover:text-foreground",
              disabled && "pointer-events-none opacity-40",
            )}
          >
            <IconContrast className="size-3.5 shrink-0" aria-hidden />
            {reading.kind === "loading" ? (
              <Skeleton className="h-3 w-12" />
            ) : ready ? (
              <span>{`${formatContrastRatio(ready.ratio)} : 1`}</span>
            ) : (
              <span className="truncate">
                {t("editPanel.colorPicker.contrastUnavailable")}
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[232px]">
          <ContrastMenuItems
            reading={reading}
            previewFix={previewFix}
            onFix={onFix}
            onAskAgent={onAskAgent}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {ready ? (
        <span
          title={
            ready.level
              ? t("editPanel.colorPicker.contrastMeets", {
                  level: ready.level,
                })
              : t("editPanel.colorPicker.fixNeeds", {
                  ratio: String(ready.targets.aa),
                })
          }
          className={cn(
            "flex items-center gap-1 !text-[11px] font-medium",
            ready.level
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-amber-600 dark:text-amber-400",
          )}
        >
          {ready.level ? (
            <IconCheck className="size-3.5" aria-hidden />
          ) : (
            <IconAlertTriangle className="size-3.5" aria-hidden />
          )}
          {/* WCAG's own names for the conformance levels. */}
          {ready.level ?? "AA"}
        </span>
      ) : null}
    </div>
  );
}

function ContrastMenuItems({
  reading,
  previewFix,
  onFix,
  onAskAgent,
}: {
  reading: ContrastReading;
  previewFix: (target: number) => ContrastFix;
  onFix: (target: number) => void;
  onAskAgent: () => void;
}) {
  const t = useT();
  const levels =
    reading.kind === "ready"
      ? [
          {
            label: t("editPanel.colorPicker.fixAa"),
            target: reading.targets.aa,
          },
          {
            label: t("editPanel.colorPicker.fixAaa"),
            target: reading.targets.aaa,
          },
        ].map((level) => {
          const met = reading.ratio >= level.target;
          const reachable = met || previewFix(level.target).kind === "fixed";
          return {
            ...level,
            enabled: !met && reachable,
            status: met
              ? t("editPanel.colorPicker.fixPasses")
              : reachable
                ? t("editPanel.colorPicker.fixNeeds", {
                    ratio: String(level.target),
                  })
                : t("editPanel.colorPicker.fixUnreachable"),
          };
        })
      : [];
  return (
    <>
      {levels.map((level) => (
        <DropdownMenuItem
          key={level.label}
          disabled={!level.enabled}
          className="h-7 justify-between !text-[11px]"
          onSelect={() => onFix(level.target)}
        >
          {level.label}
          <span className="text-muted-foreground">{level.status}</span>
        </DropdownMenuItem>
      ))}
      {levels.length > 0 ? <DropdownMenuSeparator /> : null}
      <DropdownMenuItem className="h-7 !text-[11px]" onSelect={onAskAgent}>
        {t("editPanel.colorPicker.askAgentContrast")}
      </DropdownMenuItem>
    </>
  );
}

const SQUARE = 248;

/**
 * Over the color square in contrast mode: the line where the target is met,
 * and dots on the side that misses it.
 */
export function ContrastOverlay({ map }: { map: ContrastMap }) {
  const patternId = useId();
  const x = (s: number) => s * SQUARE;
  const y = (v: number) => (1 - v) * SQUARE;
  const point = (s: number, v: number) =>
    `${x(s).toFixed(1)} ${y(v).toFixed(1)}`;
  const missing = map.bands
    .map((run) =>
      [
        ...run.map((band) => point(band.s, band.hi)),
        ...[...run].reverse().map((band) => point(band.s, band.lo)),
      ].join(" L "),
    )
    .map((run) => `M ${run} Z`)
    .join(" ");
  const lines = map.lines
    .filter((line) => line.length > 1)
    .map((line) => `M ${line.map((p) => point(p.s, p.v)).join(" L ")}`)
    .join(" ");
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${SQUARE} ${SQUARE}`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 size-full overflow-hidden rounded"
    >
      <defs>
        <pattern
          id={patternId}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="3" cy="3" r="0.9" fill="white" fillOpacity="0.55" />
        </pattern>
      </defs>
      {missing ? <path d={missing} fill={`url(#${patternId})`} /> : null}
      {lines ? (
        <>
          <path
            d={lines}
            fill="none"
            stroke="black"
            strokeOpacity="0.3"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <path
            d={lines}
            fill="none"
            stroke="white"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </>
      ) : null}
    </svg>
  );
}
