import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import { IconArrowsHorizontal } from "@tabler/icons-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

import {
  formatScrubValue,
  getScrubStepFromEvent,
  normalizeScrubNumber,
  parseScrubExpression,
  startScrubDrag,
  updateScrubDrag,
  type ScrubExpressionOptions,
} from "./scrub-input-utils";

type ScrubInputIcon = (props: { className?: string }) => ReactNode;

export interface ScrubInputChangeMeta {
  source: "commit" | "keyboard" | "scrub";
  expression?: string;
  /**
   * Gesture-lifecycle signal for downstream consumers that want to throttle
   * expensive work during a drag and only do the expensive commit once.
   *
   * - "preview": a live, in-progress tick — e.g. one pointermove sample while
   *   scrubbing. There can be many of these per gesture; treat each as a
   *   cheap, throttleable preview of the value, not a point to commit at full
   *   cost.
   * - "commit": the gesture's authoritative, final value. Fired exactly once
   *   per gesture: on pointerup that ends a scrub drag, and for every
   *   `source: "commit"` (blur/Enter) or `source: "keyboard"` (arrow step)
   *   change, since those are already discrete, complete edits.
   */
  phase: "preview" | "commit";
}

export interface ScrubInputProps extends ScrubExpressionOptions {
  label: string;
  value: number;
  onChange: (value: number, meta: ScrubInputChangeMeta) => void;
  id?: string;
  step?: number;
  icon?: ScrubInputIcon | null;
  disabled?: boolean;
  placeholder?: string;
  mixed?: boolean;
  className?: string;
  inputClassName?: string;
  labelClassName?: string;
  ariaLabel?: string;
  tooltipLabel?: string;
}

export function ScrubInput({
  label,
  value,
  onChange,
  id,
  step = 1,
  unit,
  min,
  max,
  precision,
  icon: Icon = IconArrowsHorizontal,
  disabled = false,
  placeholder,
  mixed = false,
  className,
  inputClassName,
  labelClassName,
  ariaLabel,
  tooltipLabel,
}: ScrubInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [draft, setDraft] = useState(() =>
    mixed ? "Mixed" : formatScrubValue(value, { unit, precision }),
  );
  // Track the latest draft in a ref so commitDraft always reads the most
  // up-to-date value even if the blur event fires before the React state
  // update has been committed to the render tree (concurrent mode / batching).
  const draftRef = useRef(draft);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipNextBlurCommitRef = useRef(false);
  const dragRef = useRef({
    pointerId: -1,
    drag: startScrubDrag(0),
  });
  // The last normalized value emitted as a "preview" scrub tick, so endDrag
  // can re-emit it once as the gesture's authoritative "commit" — without
  // recomputing from stale pointer deltas after pointer capture is released.
  const lastScrubValueRef = useRef(value);

  useEffect(() => {
    if (!focused) {
      const formatted = mixed
        ? "Mixed"
        : formatScrubValue(value, { unit, precision });
      draftRef.current = formatted;
      setDraft(formatted);
    }
  }, [focused, mixed, precision, unit, value]);

  const options = { unit, min, max, precision };
  const resolvedTooltipLabel = tooltipLabel ?? ariaLabel ?? label;

  const setNextValue = (nextValue: number, meta: ScrubInputChangeMeta) => {
    const normalized = normalizeScrubNumber(nextValue, options);
    onChange(normalized, meta);
    const formatted = formatScrubValue(normalized, options);
    draftRef.current = formatted;
    setDraft(formatted);
    return normalized;
  };

  const commitDraft = () => {
    // Always read from the ref so we use the latest typed value even if the
    // React render with the updated draft state hasn't committed yet (e.g.
    // when blur fires in the same synchronous batch as the last onChange).
    const currentDraft = draftRef.current;
    if (mixed && currentDraft === "Mixed") return;
    const parsed = parseScrubExpression(currentDraft, value, options);
    if (!parsed) {
      const reverted = mixed ? "Mixed" : formatScrubValue(value, options);
      draftRef.current = reverted;
      setDraft(reverted);
      return;
    }

    draftRef.current = parsed.normalized;
    setDraft(parsed.normalized);
    // From a mixed selection every explicitly typed value must commit, even
    // when it equals the placeholder `value` prop (e.g. typing "0"): the
    // selected objects hold differing values, so "no change" is meaningless.
    if (parsed.value !== value || mixed) {
      onChange(parsed.value, {
        source: "commit",
        expression: currentDraft,
        phase: "commit",
      });
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      // Mixed selection: the `value` prop is only a placeholder (typically 0),
      // so stepping from it would snap every selected object to a value the
      // user never chose. Require an explicit typed value first — typing then
      // committing applies to all, which is the design-editor convention.
      if (mixed) return;
      const direction = event.key === "ArrowUp" ? 1 : -1;
      // getScrubStepFromEvent handles shiftKey (×10) and altKey (÷10).
      // Cmd (metaKey) mirrors Shift for ×10 — editor convention on macOS.
      const baseStep = getScrubStepFromEvent(event, step);
      const cmdMultiplier = event.metaKey && !event.shiftKey ? 10 : 1;
      // Step from the currently typed draft, not the last-committed `value`
      // prop — otherwise an in-progress, uncommitted edit (typed but not yet
      // blurred/entered) is silently discarded the moment an arrow key is
      // pressed. Parse the draft the same way commitDraft does, falling back
      // to `value` only when the draft doesn't parse (e.g. empty/invalid).
      const draftParsed = parseScrubExpression(
        draftRef.current,
        value,
        options,
      );
      const base = draftParsed ? draftParsed.value : value;
      setNextValue(base + direction * baseStep * cmdMultiplier, {
        source: "keyboard",
        phase: "commit",
      });
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      commitDraft();
      skipNextBlurCommitRef.current = true;
      event.currentTarget.blur();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      const reverted = mixed ? "Mixed" : formatScrubValue(value, options);
      draftRef.current = reverted;
      setDraft(reverted);
      skipNextBlurCommitRef.current = true;
      event.currentTarget.blur();
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLLabelElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      drag: startScrubDrag(event.clientX),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLLabelElement>) => {
    if (!dragging || dragRef.current.pointerId !== event.pointerId) return;
    // Mixed selection: scrubbing has no meaningful base value (the `value`
    // prop is a placeholder), so committing drag deltas would snap every
    // selected object to a step-from-0 value. Keep the drag inert; releasing
    // without a committed drag focuses the input so the user can type an
    // explicit value that then applies to all.
    if (mixed) return;
    // updateScrubDrag mirrors the jitter-threshold + hasDragged bookkeeping
    // (see scrub-input-utils.ts) so it can be unit tested in isolation from
    // real DOM pointer events.
    const tick = updateScrubDrag(dragRef.current.drag, event.clientX);
    dragRef.current.drag = tick.state;
    if (tick.deltaX === null) return;
    // Use incremental deltas from the last move so that clamped/rounded values
    // committed by onChange are respected. A total-delta approach would create
    // a dead zone equal to the amount dragged past the clamp boundary.
    const next =
      value +
      tick.deltaX *
        getScrubStepFromEvent(
          { altKey: event.altKey, shiftKey: event.shiftKey },
          step,
        );
    lastScrubValueRef.current = setNextValue(next, {
      source: "scrub",
      phase: "preview",
    });
  };

  const endDrag = (event: PointerEvent<HTMLLabelElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const wasDrag = dragRef.current.drag.hasDragged;
    setDragging(false);
    // A real scrub drag emitted only "preview" ticks via handlePointerMove.
    // Emit exactly one authoritative "commit" here with the final value so a
    // downstream consumer can distinguish "gesture finished" from "still
    // dragging" — without this, the last preview tick would be the only
    // signal, and a consumer that ignores preview ticks would never commit.
    if (wasDrag && !mixed) {
      onChange(lastScrubValueRef.current, {
        source: "scrub",
        phase: "commit",
      });
    }
    // If the pointer was released without dragging (a plain click), focus the
    // input so the user can type immediately — mirrors the design editor's label click
    // behaviour (the event.preventDefault() in handlePointerDown blocks the
    // native label→input focus transfer).
    if (!wasDrag && !disabled) {
      inputRef.current?.focus();
    }
  };

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Label
            htmlFor={inputId}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className={cn(
              "flex h-6 w-20 shrink-0 cursor-ew-resize select-none items-center gap-1 rounded-sm !text-[11px] text-muted-foreground transition-colors",
              "hover:bg-[var(--design-editor-control-bg)] hover:text-foreground",
              dragging &&
                "bg-[var(--design-editor-control-bg)] text-foreground",
              disabled && "pointer-events-none cursor-not-allowed opacity-50",
              labelClassName,
            )}
          >
            {Icon ? <Icon className="size-3 shrink-0" /> : null}
            <span className="truncate">{label}</span>
          </Label>
        </TooltipTrigger>
        <TooltipContent>{resolvedTooltipLabel}</TooltipContent>
      </Tooltip>
      <Input
        ref={inputRef}
        id={inputId}
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        inputMode="decimal"
        aria-label={ariaLabel ?? label}
        onFocus={(event) => {
          setFocused(true);
          event.currentTarget.select();
        }}
        onBlur={() => {
          setFocused(false);
          if (skipNextBlurCommitRef.current) {
            skipNextBlurCommitRef.current = false;
            return;
          }
          commitDraft();
        }}
        onChange={(event) => {
          draftRef.current = event.target.value;
          setDraft(event.target.value);
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          // Compact design-editor: h-6, 11px tabular text, ring-1 with no offset.
          "h-6 !text-[11px] tabular-nums",
          "focus-visible:ring-1 focus-visible:ring-offset-0",
          inputClassName,
          mixed && "text-muted-foreground",
        )}
      />
    </div>
  );
}
