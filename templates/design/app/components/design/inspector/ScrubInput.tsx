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
  type ScrubExpressionOptions,
} from "./scrub-input-utils";

type ScrubInputIcon = (props: { className?: string }) => ReactNode;

export interface ScrubInputChangeMeta {
  source: "commit" | "keyboard" | "scrub";
  expression?: string;
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
    startX: 0,
    prevX: 0,
    hasDragged: false,
  });

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
    if (parsed.value !== value) {
      onChange(parsed.value, { source: "commit", expression: currentDraft });
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
      setNextValue(value + direction * baseStep * cmdMultiplier, {
        source: "keyboard",
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
      startX: event.clientX,
      prevX: event.clientX,
      hasDragged: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLLabelElement>) => {
    if (!dragging || dragRef.current.pointerId !== event.pointerId) return;
    const incr = event.clientX - dragRef.current.prevX;
    if (incr === 0) return;
    dragRef.current.prevX = event.clientX;
    dragRef.current.hasDragged = true;
    // Use incremental deltas from the last move so that clamped/rounded values
    // committed by onChange are respected. A total-delta approach would create
    // a dead zone equal to the amount dragged past the clamp boundary.
    const next =
      value +
      incr *
        getScrubStepFromEvent(
          { altKey: event.altKey, shiftKey: event.shiftKey },
          step,
        );
    setNextValue(next, { source: "scrub" });
  };

  const endDrag = (event: PointerEvent<HTMLLabelElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const wasDrag = dragRef.current.hasDragged;
    setDragging(false);
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
