import { useT } from "@agent-native/core/client/i18n";
import {
  cloneElement,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  useVideoStorageStatus,
  type VideoStorageStatus,
} from "@/hooks/use-video-storage-status";

import { FreeClipsLimitCard } from "./free-clips-limit-card";
import { trackFreeClipsOffer } from "./use-builder-storage-activation";

const LAST_CLIP_PROMPT_SEEN_KEY = "clips:last-clip-prompt-seen";

type GateAnchor = ReactElement<{
  onClick?: (event: MouseEvent<HTMLElement>) => void;
}>;

export function lastClipPromptSeen(): boolean {
  try {
    return window.localStorage.getItem(LAST_CLIP_PROMPT_SEEN_KEY) === "1";
    // coercion-ok: an unreadable store shows the once-only prompt again, which is harmless
  } catch {
    return false;
  }
}

export function markLastClipPromptSeen(): void {
  try {
    window.localStorage.setItem(LAST_CLIP_PROMPT_SEEN_KEY, "1");
    // coercion-ok: a blocked store only means the prompt can show once more
  } catch {
    // A blocked store only means the prompt can show once more.
  }
}

/**
 * Anything that would store a new clip (a recording, an upload, a Loom or
 * video-link import) asks first, anchored to the control that started it:
 * the limit card once the free clips are used up, and the last-clip prompt
 * the first time the last one would be used, which can still go ahead.
 *
 * `guard(proceed)` returns true when it took over; `wrap(anchor)` places the
 * popover against that control. When another Slot (a tooltip trigger) has to
 * hold the control directly, render `root` outside it and `anchor` inside.
 */
export function useFreeClipsGate(action: "record" | "upload") {
  const t = useT();
  const storage = useVideoStorageStatus();
  const [open, setOpen] = useState(false);
  // The actions held while the prompt is open. A repeat of the same control
  // replaces its action; `queue` keeps each one, for drops of separate files.
  const pendingRef = useRef<(() => void)[]>([]);
  // Queued drops already hold their files, so they can go ahead on their
  // own; a click's action (a file picker, a recording) needs a fresh click.
  const resumableRef = useRef(false);
  const openRef = useRef(false);
  const status = storage.data;
  const usedUp = status?.denyReason === "exhausted";
  // What the open prompt is about can stop applying under it, such as
  // Builder.io storage connecting; it closes rather than show a stale limit.
  const promptApplies =
    usedUp || (status?.mode === "hosted" && status.hostedRemaining === 1);

  const guard = (
    proceed: () => void,
    {
      queue = false,
      status: fresh = status,
    }: {
      queue?: boolean;
      /** A status read just now, in place of the cached one. */
      status?: VideoStorageStatus;
    } = {},
  ): boolean => {
    if (!fresh) return false;
    const lastClip =
      // Read at the click, so a prompt seen through another gate counts.
      !lastClipPromptSeen() &&
      fresh.mode === "hosted" &&
      fresh.hostedRemaining === 1;
    if (fresh.denyReason !== "exhausted" && !lastClip) return false;
    if (lastClip) markLastClipPromptSeen();
    pendingRef.current =
      queue && openRef.current ? [...pendingRef.current, proceed] : [proceed];
    resumableRef.current = queue;
    openRef.current = true;
    // After the click settles, so a menu closing on it can't close this too.
    setTimeout(() => setOpen(true), 0);
    return true;
  };

  const close = () => {
    pendingRef.current = [];
    openRef.current = false;
    setOpen(false);
  };

  // When the prompt stops applying under it, held drops go ahead and a held
  // click is told what changed, so nothing is dropped without a word.
  const storageUsable = status?.configured === true;
  const ownStorage = storageUsable && status.mode === "own";
  const hostedLeft =
    storageUsable && status.mode === "hosted" ? status.hostedRemaining : null;
  useEffect(() => {
    if (!open || promptApplies) return;
    const held = pendingRef.current;
    pendingRef.current = [];
    openRef.current = false;
    setOpen(false);
    if (held.length === 0) return;
    if (resumableRef.current) {
      // Drops read the status again as they're admitted, so they go ahead
      // or reach the right setup whatever changed.
      for (const proceed of held) proceed();
    } else if (ownStorage) {
      // A held click needs a fresh one; say what it can now go ahead with.
      toast.success(t("storageSetup.builderConnected"));
    } else if (hostedLeft !== null) {
      toast(t("recordRoute.freeClipsLeft", { count: hostedLeft }));
    } else {
      toast.error(t("recordingPage.storageStillDisconnected"));
    }
  }, [hostedLeft, open, ownStorage, promptApplies, t]);

  const anchor = (control: ReactElement) => (
    <PopoverAnchor asChild>{control}</PopoverAnchor>
  );

  const root = (
    children: ReactNode,
    align: "start" | "center" | "end" = "end",
  ) => (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setOpen(true);
          return;
        }
        // Escape or a click outside; the card's own buttons track themselves.
        if (status) {
          trackFreeClipsOffer("clips_free_clips_offer_dismissed", {
            surface: "library_limit_popover",
            milestone: usedUp ? "used_up" : "last_clip_intent",
            remaining: usedUp ? 0 : 1,
            limit: status.hostedLimit,
            action,
          });
        }
        close();
      }}
    >
      {children}
      {open && status && promptApplies ? (
        <PopoverContent
          align={align}
          sideOffset={8}
          // A menu that opened this hands focus back to its trigger as it
          // closes; only a click outside or Escape should close the prompt.
          onFocusOutside={(event) => event.preventDefault()}
          className="w-[340px] max-w-[calc(100vw-2rem)] p-0"
        >
          <FreeClipsLimitCard
            variant="popover"
            kind={usedUp ? "used_up" : "last_clip"}
            action={action}
            limit={status.hostedLimit}
            onDismiss={close}
            onProceed={() => {
              const pending = pendingRef.current;
              close();
              for (const proceed of pending) proceed();
            }}
          />
        </PopoverContent>
      ) : null}
    </Popover>
  );

  const wrap = (
    control: ReactElement,
    align: "start" | "center" | "end" = "end",
  ) => root(anchor(control), align);

  return { guard, wrap, root, anchor };
}

/** A record control gated by {@link useFreeClipsGate}. */
export function FreeClipsLimitGate({
  children,
  onProceed,
  align = "end",
}: {
  children: GateAnchor;
  /** What the control does without the gate, for "Record my last free clip". */
  onProceed: () => void;
  align?: "start" | "center" | "end";
}) {
  const gate = useFreeClipsGate("record");
  return gate.wrap(
    cloneElement(children, {
      onClick: (event: MouseEvent<HTMLElement>) => {
        if (gate.guard(onProceed)) {
          event.preventDefault();
          return;
        }
        children.props.onClick?.(event);
      },
    }),
    align,
  );
}
