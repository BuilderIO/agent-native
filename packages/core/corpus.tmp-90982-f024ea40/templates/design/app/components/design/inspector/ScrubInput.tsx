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

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  formatScrubValue,
  getScrubStepFromEvent,
  normalizeScrubNumber,
  parseScrubExpression,
  roundScrubDragValue,
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
  /**
   * Set when an arrow-key nudge fires on a `mixed` selection (see
   * `handleKeyDown`): there is no single current value to step from across a
   * mixed selection, so `onChange`'s `value` arg is the step delta itself
   * (not a new absolute value) and consumers that support per-target relative
   * application should add this delta to each selected target's own current
   * value instead of overwriting every target with `value`. Omitted for
   * every other change — existing consumers that don't check for it keep
   * receiving absolute values exactly as before.
   */
  relativeDelta?: number;
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

export interface PendingScrubCommit {
  value: number;
  /** Incoming prop value at commit time. While this exact value remains, the
   * host has not acknowledged the write yet and the optimistic draft should
   * stay visible. A different incoming value is authoritative host
   * normalization/rejection and must supersede the optimistic draft. */
  baseline: number;
}

export function resolvePendingScrubCommit(
  pending: PendingScrubCommit | null,
  incomingValue: number,
  options: ScrubExpressionOptions,
): "none" | "hold" | "confirmed" | "superseded" {
  if (pending === null) return "none";
  const incoming = normalizeScrubNumber(incomingValue, options);
  if (incoming === pending.value) return "confirmed";
  return incoming === pending.baseline ? "hold" : "superseded";
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
  // The most recent value THIS input committed (typed Enter/blur, keyboard
  // nudge, or scrub release) that the host hasn't echoed back yet. While this
  // is set, the resync effect below must hold the optimistic committed
  // display instead of snapping back to the still-stale incoming `value`
  // prop — otherwise a round-trip slower than one React render (host commit
  // -> computedStyles update -> fresh `value` prop) clobbers the just-typed
  // value back to the old one the instant focus leaves the input, which
  // reads as "Enter resets to the old value". Cleared as soon as a fresh
  // `value` prop confirms (or supersedes) the pending commit.
  const pendingCommitRef = useRef<PendingScrubCommit | null>(null);
  const options = { unit, min, max, precision };

  useEffect(() => {
    if (mixed) pendingCommitRef.current = null;
    const resolution = resolvePendingScrubCommit(
      pendingCommitRef.current,
      value,
      options,
    );
    if (resolution !== "none") {
      if (resolution === "confirmed" || resolution === "superseded") {
        // The host either echoed exactly what we committed or returned a new,
        // authoritative normalized/rejected value. In both cases resume prop
        // synchronization. The old equality-only logic held forever on the
        // second path, leaving the field permanently stuck on a value the
        // canvas never accepted.
        pendingCommitRef.current = null;
      } else {
        // Still seeing the exact pre-commit prop — don't stomp the optimistic
        // draft while the source-write round trip is pending.
        return;
      }
    }
    if (!focused) {
      const formatted = mixed
        ? "Mixed"
        : formatScrubValue(value, { unit, precision });
      draftRef.current = formatted;
      setDraft(formatted);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `options` is a fresh object every render; the individual fields it's built from (unit/min/max/precision) are already listed below.
  }, [focused, max, min, mixed, precision, unit, value]);

  const resolvedTooltipLabel = tooltipLabel ?? ariaLabel ?? label;

  const setNextValue = (nextValue: number, meta: ScrubInputChangeMeta) => {
    const normalized = normalizeScrubNumber(nextValue, options);
    // Mark commit-phase writes as pending confirmation so the resync effect
    // holds this optimistic display instead of reverting to a stale `value`
    // prop before the host's round-trip lands (see pendingCommitRef above).
    // Preview ticks don't need this: they're expected to be superseded by
    // the next tick or the gesture's own final commit almost immediately.
    if (meta.phase === "commit") {
      pendingCommitRef.current = {
        value: normalized,
        baseline: normalizeScrubNumber(value, options),
      };
    }
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
      // See setNextValue's pendingCommitRef comment — this text-commit path
      // (Enter/blur) bypasses setNextValue, so mark it pending here too.
      pendingCommitRef.current = {
        value: parsed.value,
        baseline: normalizeScrubNumber(value, options),
      };
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
      const direction = event.key === "ArrowUp" ? 1 : -1;
      // getScrubStepFromEvent handles shiftKey (×10) and altKey (÷10).
      // Cmd (metaKey) mirrors Shift for ×10 — editor convention on macOS.
      const baseStep = getScrubStepFromEvent(event, step);
      const cmdMultiplier = event.metaKey && !event.shiftKey ? 10 : 1;
      const delta = direction * baseStep * cmdMultiplier;
      // Mixed selection: the `value` prop is only a placeholder (typically 0)
      // — there's no single current value to step from, and there's no
      // typed draft either (mixed keeps the draft as the literal "Mixed"
      // string, see commitDraft's guard). Figma's behavior here is a
      // *relative* nudge: apply the same +/-delta to each selected object's
      // own value rather than snapping every object to one absolute number.
      // ScrubInput itself can't resolve each target's individual value, so
      // emit the delta via `onChange` (as both `value` and
      // `meta.relativeDelta`) and let the consumer apply it per-target. Do
      // NOT route through setNextValue: that formats/displays one absolute
      // number in the draft, which would incorrectly replace the "Mixed"
      // placeholder text with a single value that was never actually common
      // to the whole selection.
      if (mixed) {
        onChange(delta, {
          source: "keyboard",
          phase: "commit",
          relativeDelta: delta,
        });
        return;
      }
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
      setNextValue(base + delta, {
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
    // Re-seed the gesture's running base from the current prop right as the
    // drag starts. Without this, a stale `lastScrubValueRef` left over from a
    // previous gesture (or from an out-of-band prop update that arrived while
    // not dragging) would silently become this gesture's starting point
    // instead of the value actually displayed when the user grabbed the
    // control.
    lastScrubValueRef.current = value;
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
    //
    // Accumulate from this gesture's OWN last emitted value
    // (lastScrubValueRef), not the `value` prop. The prop only reflects
    // whatever the host last echoed back through computedStyles — a "preview"
    // phase commit is not guaranteed to round-trip before the next
    // pointermove tick fires (the host may debounce/throttle/skip preview
    // writes), so re-reading `value` here would recompute every tick from a
    // stale, pre-drag base plus one tiny incremental delta: the displayed
    // number barely creeps from the original value instead of following the
    // cursor, which reads as jittery/near-random rather than a smooth
    // continuum. The gesture's own running total is always current because
    // this component sets it itself on every tick below.
    const next =
      lastScrubValueRef.current +
      tick.deltaX *
        getScrubStepFromEvent(
          { altKey: event.altKey, shiftKey: event.shiftKey },
          step,
        );
    // Px-type fields snap to whole numbers while scrubbing (see
    // roundScrubDragValue) even though `precision` — which also governs typed
    // input and keyboard nudges — allows a decimal. Rounding here, before
    // setNextValue's own normalizeScrubNumber pass, keeps every subsequent
    // incremental delta measured from an already-whole value instead of
    // drifting on fractional leftovers.
    lastScrubValueRef.current = setNextValue(roundScrubDragValue(next, unit), {
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
      // See setNextValue's pendingCommitRef comment — mark this gesture's
      // authoritative value as pending confirmation so releasing the drag
      // can't be clobbered back to the pre-drag value by a slow host
      // round-trip (same class of bug as the Enter/blur text-commit case).
      pendingCommitRef.current = {
        value: lastScrubValueRef.current,
        baseline: normalizeScrubNumber(value, options),
      };
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
