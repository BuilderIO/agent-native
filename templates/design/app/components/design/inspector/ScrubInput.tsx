import { IconArrowsHorizontal } from "@tabler/icons-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type PointerEvent,
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

type ScrubInputIcon = ComponentType<{ className?: string }>;

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
  icon?: ScrubInputIcon;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  labelClassName?: string;
  ariaLabel?: string;
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
  className,
  inputClassName,
  labelClassName,
  ariaLabel,
}: ScrubInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [draft, setDraft] = useState(() =>
    formatScrubValue(value, { unit, precision }),
  );
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const skipNextBlurCommitRef = useRef(false);
  const dragRef = useRef({
    pointerId: -1,
    startX: 0,
    startValue: value,
  });

  useEffect(() => {
    if (!focused) setDraft(formatScrubValue(value, { unit, precision }));
  }, [focused, precision, unit, value]);

  const options = { unit, min, max, precision };

  const setNextValue = (nextValue: number, meta: ScrubInputChangeMeta) => {
    const normalized = normalizeScrubNumber(nextValue, options);
    onChange(normalized, meta);
    setDraft(formatScrubValue(normalized, options));
  };

  const commitDraft = () => {
    const parsed = parseScrubExpression(draft, value, options);
    if (!parsed) {
      setDraft(formatScrubValue(value, options));
      return;
    }

    setDraft(parsed.normalized);
    if (parsed.value !== value) {
      onChange(parsed.value, { source: "commit", expression: draft });
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const direction = event.key === "ArrowUp" ? 1 : -1;
      setNextValue(value + direction * getScrubStepFromEvent(event, step), {
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
      setDraft(formatScrubValue(value, options));
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
      startValue: value,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLLabelElement>) => {
    if (!dragging || dragRef.current.pointerId !== event.pointerId) return;
    const delta = event.clientX - dragRef.current.startX;
    if (delta === 0) return;
    const next =
      dragRef.current.startValue +
      delta *
        getScrubStepFromEvent(
          { altKey: event.altKey, shiftKey: event.shiftKey },
          step,
        );
    setNextValue(next, { source: "scrub" });
  };

  const endDrag = (event: PointerEvent<HTMLLabelElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
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
              "flex h-6 w-20 shrink-0 cursor-ew-resize select-none items-center gap-1 text-[11px] text-muted-foreground",
              dragging && "text-foreground",
              disabled && "pointer-events-none cursor-not-allowed opacity-50",
              labelClassName,
            )}
          >
            <Icon className="size-3 shrink-0" />
            <span className="truncate">{label}</span>
          </Label>
        </TooltipTrigger>
        <TooltipContent>{`${label}. Drag to scrub, use arrows to step.`}</TooltipContent>
      </Tooltip>
      <Input
        id={inputId}
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        inputMode="decimal"
        aria-label={ariaLabel ?? label}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (skipNextBlurCommitRef.current) {
            skipNextBlurCommitRef.current = false;
            return;
          }
          commitDraft();
        }}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        className={cn("h-6 text-[11px] tabular-nums", inputClassName)}
      />
    </div>
  );
}
