import { LazyChunkRetryFallback } from "@agent-native/core/client/lazy-chunk-retry-fallback";
import type { CSSProperties, RefObject } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Skeleton } from "@/components/ui/skeleton";

export function DeferredPopoverFallback({
  surface,
  anchorRef,
  centered = false,
  failed = false,
  onClose,
}: {
  surface: "prompt" | "add-slide";
  anchorRef?: RefObject<HTMLElement | null>;
  centered?: boolean;
  failed?: boolean;
  onClose?: () => void;
}) {
  const [position, setPosition] = useState<CSSProperties>({
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
  });
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onClose) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        contentRef.current?.contains(target) ||
        anchorRef?.current?.contains(target)
      ) {
        return;
      }
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchorRef, onClose]);

  useLayoutEffect(() => {
    const anchor = anchorRef?.current;
    if (centered || !anchor) {
      setPosition({
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      });
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const width = Math.min(
      surface === "prompt" ? 500 : 420,
      window.innerWidth - 24,
    );
    if (surface === "add-slide") {
      setPosition({
        top: Math.max(12, Math.min(rect.top, window.innerHeight - 332)),
        left: Math.min(rect.right + 8, window.innerWidth - width - 12),
      });
      return;
    }

    const height = 240;
    let top = rect.bottom + 12;
    if (top + height > window.innerHeight - 12) {
      top = Math.max(12, rect.top - height - 12);
    }
    let left = rect.left + rect.width / 2 - width / 2;
    if (left + width > window.innerWidth - 12) {
      left = window.innerWidth - width - 12;
    }
    if (left < 12) left = 12;
    setPosition({ top, left });
  }, [anchorRef, centered, surface]);

  if (typeof document === "undefined") return null;

  const prompt = surface === "prompt";
  return createPortal(
    <>
      {centered && prompt ? (
        <div
          // guard:allow-raw-color — modal scrim remains black in either theme.
          className="fixed inset-0 z-[199] bg-black/40"
        />
      ) : null}
      <div
        ref={contentRef}
        role={failed ? "alert" : "dialog"}
        aria-modal={prompt && centered ? true : undefined}
        aria-busy={failed ? undefined : true}
        className={
          prompt
            ? "fixed z-[200] w-[min(500px,calc(100vw-24px))] rounded-xl border border-border/80 bg-popover shadow-xl shadow-black/15"
            : "fixed z-[200] w-[min(420px,calc(100vw-24px))] rounded-xl border border-border bg-popover p-3 shadow-2xl shadow-black/60"
        }
        style={position}
      >
        {failed ? (
          <div className="flex min-h-12 items-center justify-center p-3">
            <LazyChunkRetryFallback />
          </div>
        ) : prompt ? (
          <>
            <div className="flex items-center justify-between gap-3 px-4 pb-2.5 pt-3.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-10" />
            </div>
            <div className="px-2.5 pb-2.5">
              <Skeleton className="h-36 w-full rounded-lg" />
            </div>
            <div className="flex items-center gap-2 border-t border-border/60 px-4 py-2.5">
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-6 w-20" />
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between px-1 pb-2">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="size-5" />
            </div>
            <Skeleton className="mb-2 h-8 w-full rounded-md" />
            <Skeleton className="h-36 w-full rounded-lg" />
          </>
        )}
      </div>
    </>,
    document.body,
  );
}
