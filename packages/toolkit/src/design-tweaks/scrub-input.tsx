import { IconArrowsHorizontal } from "@tabler/icons-react";
import { IconMinus, IconPlus } from "@tabler/icons-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip.js";
import { cn } from "../utils.js";
import {
  formatScrubValue,
  getScrubStepFromEvent,
  normalizeScrubMixedExpression,
  normalizeScrubNumber,
  parseScrubExpression,
  parseScrubRelativeExpression,
  roundScrubDragValue,
  startScrubDrag,
  updateScrubDrag,
  type ScrubExpressionOptions,
  type ScrubRelativeExpression,
} from "./scrub-input-utils.js";

type ScrubInputIcon = (props: {
  className?: string;
  "aria-hidden"?: boolean;
}) => ReactNode;

export interface ScrubInputChangeMeta {
  source: "commit" | "keyboard" | "scrub";
  expression?: string;
  altKey?: boolean;
  phase: "preview" | "commit" | "cancel";
  relativeDelta?: number;
  relativeExpression?: ScrubRelativeExpression;
}

export interface ScrubInputProps extends ScrubExpressionOptions {
  label: string;
  value: number;
  onChange: (value: number, meta: ScrubInputChangeMeta) => void;
  textValue?: string;
  onTextCommit?: (
    draft: string,
    meta: ScrubInputChangeMeta,
  ) => ScrubInputTextCommitResult;
  blurOnEnter?: boolean;
  id?: string;
  step?: number;
  icon?: ScrubInputIcon | null;
  prefix?: "label" | "icon";
  disabled?: boolean;
  placeholder?: string;
  mixed?: boolean;
  mixedLabel?: string;
  allowRelativeExpressions?: boolean;
  className?: string;
  inputClassName?: string;
  labelClassName?: string;
  ariaLabel?: string;
  tooltipLabel?: string;
  steppers?: boolean;
  decrementLabel?: string;
  incrementLabel?: string;
}

export type ScrubInputTextCommitResult =
  | { accepted: true; displayValue: string }
  | { accepted: false };

export interface PendingScrubCommit {
  value: number;
  baseline: number;
}

interface PendingScrubTextCommit {
  value: string;
  baseline: string;
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

export function VisualScrubInput({
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
  prefix = "label",
  disabled = false,
  placeholder,
  mixed = false,
  mixedLabel,
  textValue,
  onTextCommit,
  blurOnEnter = false,
  allowRelativeExpressions = false,
  className,
  inputClassName,
  labelClassName,
  ariaLabel,
  tooltipLabel,
  steppers = false,
  decrementLabel = "Decrease",
  incrementLabel = "Increase",
}: ScrubInputProps) {
  const resolvedMixedLabel = mixedLabel ?? "Mixed";
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [draft, setDraft] = useState(() =>
    mixed
      ? resolvedMixedLabel
      : (textValue ?? formatScrubValue(value, { unit, precision })),
  );
  const draftRef = useRef(draft);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipNextBlurCommitRef = useRef(false);
  const dragRef = useRef({
    pointerId: -1,
    drag: startScrubDrag(0),
    startedFromInput: false,
    altKey: false,
  });
  const dragStartValueRef = useRef(value);
  const dragStartTextRef = useRef(
    textValue ?? formatScrubValue(value, { unit, precision }),
  );
  const lastScrubValueRef = useRef(value);
  const pendingCommitRef = useRef<PendingScrubCommit | null>(null);
  const pendingTextCommitRef = useRef<PendingScrubTextCommit | null>(null);
  const rawDraftChangedRef = useRef(false);
  const options = { unit, min, max, precision };

  useEffect(() => {
    if (mixed) {
      pendingCommitRef.current = null;
      if (!onTextCommit) pendingTextCommitRef.current = null;
    }
    const currentTextValue =
      textValue ??
      (mixed
        ? resolvedMixedLabel
        : formatScrubValue(value, { unit, precision }));
    if (pendingTextCommitRef.current) {
      const pendingText = pendingTextCommitRef.current;
      if (currentTextValue === pendingText.value) {
        pendingTextCommitRef.current = null;
      } else if (currentTextValue === pendingText.baseline) {
        return;
      } else {
        pendingTextCommitRef.current = null;
      }
    }
    const resolution = resolvePendingScrubCommit(
      pendingCommitRef.current,
      value,
      options,
    );
    if (resolution !== "none") {
      if (resolution === "confirmed" || resolution === "superseded") {
        pendingCommitRef.current = null;
      } else {
        return;
      }
    }
    if (!focused) {
      const formatted = mixed
        ? resolvedMixedLabel
        : (textValue ?? formatScrubValue(value, { unit, precision }));
      rawDraftChangedRef.current = false;
      draftRef.current = formatted;
      setDraft(formatted);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `options` is a fresh object every render; the individual fields it's built from (unit/min/max/precision) are already listed below.
  }, [
    focused,
    max,
    min,
    mixed,
    precision,
    resolvedMixedLabel,
    textValue,
    unit,
    value,
  ]);

  const resolvedTooltipLabel = tooltipLabel ?? ariaLabel ?? label;

  const setNextValue = (nextValue: number, meta: ScrubInputChangeMeta) => {
    const normalized = normalizeScrubNumber(nextValue, options);
    rawDraftChangedRef.current = false;
    if (meta.phase === "commit") {
      pendingCommitRef.current = {
        value: normalized,
        baseline: normalizeScrubNumber(value, options),
      };
      if (onTextCommit) {
        pendingTextCommitRef.current = {
          value: formatScrubValue(normalized, options),
          baseline:
            textValue ??
            (mixed ? resolvedMixedLabel : formatScrubValue(value, options)),
        };
      }
    }
    onChange(normalized, meta);
    const formatted = formatScrubValue(normalized, options);
    draftRef.current = formatted;
    setDraft(formatted);
    return normalized;
  };

  const commitDraft = () => {
    const currentDraft = draftRef.current;
    if (mixed && currentDraft === resolvedMixedLabel) return;
    if (onTextCommit) {
      if (!rawDraftChangedRef.current) return;
      const currentTextValue =
        textValue ??
        (mixed ? resolvedMixedLabel : formatScrubValue(value, options));
      if (!mixed && currentDraft === currentTextValue) {
        rawDraftChangedRef.current = false;
        return;
      }
      rawDraftChangedRef.current = false;
      const result = onTextCommit(currentDraft, {
        source: "commit",
        expression: currentDraft,
        phase: "commit",
      });
      if (result.accepted) {
        pendingCommitRef.current = null;
        pendingTextCommitRef.current = {
          value: result.displayValue,
          baseline: currentTextValue,
        };
        draftRef.current = result.displayValue;
        setDraft(result.displayValue);
      } else {
        pendingTextCommitRef.current = null;
        draftRef.current = currentTextValue;
        setDraft(currentTextValue);
      }
      return;
    }
    if (mixed && allowRelativeExpressions) {
      const relativeExpression = normalizeScrubMixedExpression(
        currentDraft,
        resolvedMixedLabel,
      );
      const relative = relativeExpression
        ? parseScrubRelativeExpression(relativeExpression, value, options)
        : null;
      if (relativeExpression && relative) {
        draftRef.current = resolvedMixedLabel;
        setDraft(resolvedMixedLabel);
        onChange(relative.value, {
          source: "commit",
          expression: relativeExpression,
          phase: "commit",
          relativeExpression: {
            expression: relativeExpression,
            unit,
            min,
            max,
            precision,
          },
        });
        return;
      }
    }
    const parsed = parseScrubExpression(currentDraft, value, options);
    if (!parsed) {
      const reverted = mixed
        ? resolvedMixedLabel
        : formatScrubValue(value, options);
      draftRef.current = reverted;
      setDraft(reverted);
      return;
    }

    draftRef.current = parsed.normalized;
    setDraft(parsed.normalized);
    if (parsed.value !== value || mixed) {
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
      const baseStep = getScrubStepFromEvent(event, step);
      const cmdMultiplier = event.metaKey && !event.shiftKey ? 10 : 1;
      nudge(direction * baseStep * cmdMultiplier, event.altKey);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (blurOnEnter) {
        event.currentTarget.blur();
      } else {
        commitDraft();
        event.currentTarget.select();
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      rawDraftChangedRef.current = false;
      const reverted = mixed
        ? resolvedMixedLabel
        : (textValue ?? formatScrubValue(value, options));
      draftRef.current = reverted;
      setDraft(reverted);
      skipNextBlurCommitRef.current = true;
      event.currentTarget.blur();
    }
  };

  const nudge = (delta: number, altKey = false) => {
    if (mixed) {
      onChange(delta, {
        source: "keyboard",
        phase: "commit",
        relativeDelta: delta,
        ...(altKey ? { altKey: true } : {}),
      });
      return;
    }
    const draftParsed = parseScrubExpression(draftRef.current, value, options);
    const base = draftParsed ? draftParsed.value : value;
    setNextValue(base + delta, {
      source: "keyboard",
      phase: "commit",
      ...(altKey ? { altKey: true } : {}),
    });
  };

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (disabled || event.button !== 0) return;
    const startedFromInput = event.target === inputRef.current;
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      drag: startScrubDrag(event.clientX),
      startedFromInput,
      altKey: event.altKey,
    };
    dragStartValueRef.current = value;
    dragStartTextRef.current = textValue ?? formatScrubValue(value, options);
    lastScrubValueRef.current = value;
    dragContainerRef.current?.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const handleInputPointerDown = (event: PointerEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.altKey) handlePointerDown(event);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging || dragRef.current.pointerId !== event.pointerId) return;
    if (mixed) return;
    const tick = updateScrubDrag(dragRef.current.drag, event.clientX);
    dragRef.current.drag = tick.state;
    if (tick.deltaX === null) return;
    const next =
      lastScrubValueRef.current +
      tick.deltaX *
        getScrubStepFromEvent(
          {
            altKey: !dragRef.current.startedFromInput && event.altKey,
            shiftKey: event.shiftKey,
          },
          step,
        );
    lastScrubValueRef.current = setNextValue(roundScrubDragValue(next, unit), {
      source: "scrub",
      phase: "preview",
      ...(dragRef.current.altKey ? { altKey: true } : {}),
    });
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const wasDrag = dragRef.current.drag.hasDragged;
    dragRef.current.pointerId = -1;
    setDragging(false);
    if (wasDrag && !mixed) {
      pendingCommitRef.current = {
        value: lastScrubValueRef.current,
        baseline: normalizeScrubNumber(value, options),
      };
      if (onTextCommit) {
        const displayValue = formatScrubValue(
          lastScrubValueRef.current,
          options,
        );
        pendingTextCommitRef.current = {
          value: displayValue,
          baseline: textValue ?? formatScrubValue(value, options),
        };
        rawDraftChangedRef.current = false;
        draftRef.current = displayValue;
        setDraft(displayValue);
      }
      onChange(lastScrubValueRef.current, {
        source: "scrub",
        phase: "commit",
        ...(dragRef.current.altKey ? { altKey: true } : {}),
      });
    }
    if (!wasDrag && !disabled) {
      inputRef.current?.focus();
    }
  };

  const cancelDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const wasDrag = dragRef.current.drag.hasDragged;
    dragRef.current.pointerId = -1;
    setDragging(false);
    if (!wasDrag || mixed) return;

    const restoredValue = normalizeScrubNumber(
      dragStartValueRef.current,
      options,
    );
    lastScrubValueRef.current = restoredValue;
    rawDraftChangedRef.current = false;
    pendingTextCommitRef.current = null;
    const restoredText = dragStartTextRef.current;
    draftRef.current = restoredText;
    setDraft(restoredText);
    const meta = {
      source: "scrub" as const,
      expression: restoredText,
      phase: "preview" as const,
    };
    if (onTextCommit) {
      onTextCommit(restoredText, meta);
      onTextCommit(restoredText, { ...meta, phase: "cancel" });
    } else {
      onChange(restoredValue, {
        source: "scrub",
        phase: "preview",
      });
      onChange(restoredValue, {
        source: "scrub",
        phase: "cancel",
      });
    }
  };

  const stepperButton = (direction: number, stepperLabel: string) => (
    <button
      type="button"
      aria-label={stepperLabel}
      title={stepperLabel}
      disabled={disabled}
      onClick={() => nudge(direction * step)}
      className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
    >
      {direction > 0 ? (
        <IconPlus className="size-3.5" />
      ) : (
        <IconMinus className="size-3.5" />
      )}
    </button>
  );

  return (
    <div
      ref={dragContainerRef}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={cancelDrag}
      className={cn("flex min-w-0 items-center gap-1.5", className)}
    >
      {steppers ? (
        stepperButton(-1, decrementLabel)
      ) : (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Label
                htmlFor={inputId}
                onPointerDown={handlePointerDown}
                className={cn(
                  "flex h-6 shrink-0 cursor-ew-resize select-none items-center gap-1 truncate whitespace-nowrap rounded-sm !text-[11px] text-muted-foreground transition-colors",
                  prefix === "icon" ? "w-8 justify-center gap-0" : "w-20",
                  "hover:bg-[var(--design-editor-control-bg)] hover:text-foreground",
                  dragging &&
                    "bg-[var(--design-editor-control-bg)] text-foreground",
                  disabled &&
                    "pointer-events-none cursor-not-allowed opacity-50",
                  labelClassName,
                )}
              >
                {Icon ? (
                  <Icon className="size-3 shrink-0" aria-hidden={true} />
                ) : null}
                <span
                  className={cn("truncate", prefix === "icon" && "sr-only")}
                >
                  {label}
                </span>
              </Label>
            </TooltipTrigger>
            <TooltipContent>{resolvedTooltipLabel}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      <Input
        ref={inputRef}
        id={inputId}
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        inputMode={onTextCommit ? "text" : "decimal"}
        aria-label={ariaLabel ?? label}
        data-design-history-hotkeys="true"
        onFocus={(event) => {
          setFocused(true);
          if (mixed && mixedLabel !== undefined && !onTextCommit) {
            const formatted = formatScrubValue(value, options);
            draftRef.current = formatted;
            setDraft(formatted);
          }
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
          rawDraftChangedRef.current = true;
          draftRef.current = event.target.value;
          setDraft(event.target.value);
        }}
        onKeyDown={handleKeyDown}
        onPointerDown={handleInputPointerDown}
        className={cn(
          "h-6 w-0 min-w-0 flex-1 !text-[11px] tabular-nums",
          "focus-visible:ring-1 focus-visible:ring-offset-0",
          inputClassName,
          mixed && "text-muted-foreground",
          steppers && "text-center",
        )}
      />
      {steppers && stepperButton(1, incrementLabel)}
    </div>
  );
}
