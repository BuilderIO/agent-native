import { IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "../ui/button.js";
import { cn } from "../utils.js";

export interface FirstOutputNextStepLabels {
  ariaLabel: string;
  refineWithPrompt: string;
  export: string;
  shareLink: string;
  dismiss: string;
}

export interface FirstOutputNextStepBarProps {
  appId: string;
  userScope?: string;
  outputId: string;
  ready: boolean;
  labels: FirstOutputNextStepLabels;
  onRefine: () => void;
  onExport: () => void;
  onShareLink: () => void;
  positionTargetSelector?: string;
  bottomOffset?: number;
  onTrack: (
    event:
      | "first_output_next_step_shown"
      | "first_output_next_step_clicked"
      | "first_output_next_step_dismissed",
    properties: {
      app_id: string;
      output_id: string;
      action?: "refine" | "export" | "share_link";
    },
  ) => void;
  className?: string;
}

type StorageRead = "seen" | "unseen" | "unavailable";

function nextStepStorageKey(appId: string, userScope: string): string {
  return `agent-native:first-output-next-step:${appId}:${encodeURIComponent(userScope)}:v1`;
}

function readSeen(key: string): StorageRead {
  try {
    return window.localStorage.getItem(key) === "1" ? "seen" : "unseen";
  } catch {
    return "unavailable";
  }
}

export function FirstOutputNextStepBar({
  appId,
  userScope = "anonymous",
  outputId,
  ready,
  labels,
  onRefine,
  onExport,
  onShareLink,
  positionTargetSelector,
  bottomOffset = 96,
  onTrack,
  className,
}: FirstOutputNextStepBarProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  const shownRef = useRef(false);
  const storageKey = nextStepStorageKey(appId, userScope);

  useEffect(() => {
    if (!ready || !outputId || shownRef.current) return;
    const read = readSeen(storageKey);
    if (read === "seen") return;

    shownRef.current = true;
    if (read === "unseen") {
      try {
        window.localStorage.setItem(storageKey, "1");
        // coercion-ok: the bar remains available for this session when local storage is blocked.
      } catch {
        // Keep this first-view affordance available for the current session.
      }
    }
    onTrack("first_output_next_step_shown", {
      app_id: appId,
      output_id: outputId,
    });
    setVisible(true);
  }, [appId, onTrack, outputId, ready, storageKey]);

  useEffect(() => {
    if (!visible) return;

    const target = positionTargetSelector
      ? document.querySelector<HTMLElement>(positionTargetSelector)
      : null;
    const updatePosition = () => {
      const rect = target?.getBoundingClientRect();
      setPosition({
        left: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
        bottom: rect
          ? Math.max(24, window.innerHeight - rect.bottom + bottomOffset)
          : bottomOffset,
      });
    };

    updatePosition();
    const resizeObserver =
      target && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(updatePosition)
        : null;
    if (target) resizeObserver?.observe(target);
    window.addEventListener("resize", updatePosition);
    document.addEventListener("scroll", updatePosition, true);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
    };
  }, [bottomOffset, positionTargetSelector, visible]);

  if (!visible) return null;

  const trackClick = (action: "refine" | "export" | "share_link") => {
    onTrack("first_output_next_step_clicked", {
      app_id: appId,
      output_id: outputId,
      action,
    });
  };

  if (typeof document === "undefined") return null;

  if (!position) return null;

  return createPortal(
    <section
      aria-label={labels.ariaLabel}
      data-first-output-next-step="true"
      className={cn(
        "fixed z-40 flex min-h-10 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-full border border-border bg-background px-2 py-1 shadow-lg",
        className,
      )}
      style={{ left: position.left, bottom: position.bottom }}
    >
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => {
          trackClick("refine");
          onRefine();
        }}
      >
        {labels.refineWithPrompt}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          trackClick("export");
          onExport();
        }}
      >
        {labels.export}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          trackClick("share_link");
          onShareLink();
        }}
      >
        {labels.shareLink}
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={labels.dismiss}
        title={labels.dismiss}
        className="ms-auto size-8"
        onClick={() => {
          onTrack("first_output_next_step_dismissed", {
            app_id: appId,
            output_id: outputId,
          });
          setVisible(false);
        }}
      >
        <IconX aria-hidden="true" className="size-4" />
      </Button>
    </section>,
    document.body,
  );
}
