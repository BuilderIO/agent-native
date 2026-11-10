import {
  cloneElement,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { useVideoStorageStatus } from "@/hooks/use-video-storage-status";

import { FreeClipsLimitCard } from "./free-clips-limit-card";

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
  const storage = useVideoStorageStatus();
  const [open, setOpen] = useState(false);
  const [promptSeen, setPromptSeen] = useState(lastClipPromptSeen);
  const proceedRef = useRef<() => void>(() => {});
  const status = storage.data;
  const usedUp = status?.denyReason === "exhausted";
  const lastClip =
    !promptSeen && status?.mode === "hosted" && status.hostedRemaining === 1;

  const guard = (proceed: () => void): boolean => {
    if (!status || (!usedUp && !lastClip)) return false;
    if (lastClip) markLastClipPromptSeen();
    proceedRef.current = proceed;
    // After the click settles, so a menu closing on it can't close this too.
    setTimeout(() => setOpen(true), 0);
    return true;
  };

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
        setOpen(next);
        if (!next) setPromptSeen(lastClipPromptSeen());
      }}
    >
      {children}
      {open && status ? (
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
            onDismiss={() => setOpen(false)}
            onProceed={() => {
              setOpen(false);
              proceedRef.current();
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
