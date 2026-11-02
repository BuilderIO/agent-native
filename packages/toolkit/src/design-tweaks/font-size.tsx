import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "../ui/command.js";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "../ui/input-group.js";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "../ui/popover.js";
import { cn } from "../utils.js";
import {
  getScrubStepFromEvent,
  normalizeScrubMixedExpression,
  normalizeScrubNumber,
  parseScrubExpression,
  parseScrubRelativeExpression,
  roundScrubDragValue,
  startScrubDrag,
  updateScrubDrag,
  type ScrubRelativeExpression,
} from "./scrub-input-utils.js";
import { registerActiveScrubInput } from "./scrub-input.js";

const FONT_SIZE_PRECISION = 1;

/** The type scale every font size list offers. */
export const FONT_SIZE_SCALE = [
  10, 11, 12, 13, 14, 15, 16, 20, 24, 32, 36, 40, 48, 64, 96, 128,
] as const;

/**
 * The size the open list starts at: it shows this size through the largest,
 * and the smaller sizes are a scroll up.
 */
export const FONT_SIZE_LIST_ANCHOR = 16;

const LIST_PADDING_PX = 4;

export interface FontSizeNamedSize {
  label: string;
  value: number;
}

export interface FontSizeBounds {
  min?: number;
  max?: number;
}

export function formatFontSize(value: number): string {
  return String(Number(value.toFixed(FONT_SIZE_PRECISION)));
}

function clampFontSize(value: number, { min, max }: FontSizeBounds): number {
  let next = value;
  if (min !== undefined) next = Math.max(min, next);
  if (max !== undefined) next = Math.min(max, next);
  return next;
}

/**
 * The size a typed draft commits, or null when the draft is not a positive
 * size. Null means the field reverts; it never commits 0 or NaN.
 */
export function parseFontSizeInput(
  draft: string,
  currentValue: number,
  options: FontSizeBounds & { unit?: string } = {},
): number | null {
  const parsed = parseScrubExpression(draft, currentValue, {
    ...(options.unit ? { unit: options.unit } : {}),
    precision: FONT_SIZE_PRECISION,
  });
  if (!parsed || !(parsed.value > 0)) return null;
  return clampFontSize(parsed.value, options);
}

/** The next size on the scale above (1) or below (-1) `value`, if any. */
export function stepFontSize(
  value: number,
  scale: readonly number[],
  direction: 1 | -1,
  bounds: FontSizeBounds = {},
): number | null {
  const steps = [...new Set(scale)]
    .filter((size) => clampFontSize(size, bounds) === size)
    .sort((a, b) => a - b);
  const next =
    direction > 0
      ? steps.find((size) => size > value)
      : steps.reverse().find((size) => size < value);
  return next ?? null;
}

export interface FontSizeChangeMeta {
  /** A scrub sends previews, then one commit, or a cancel that restores. */
  phase: "preview" | "commit" | "cancel";
  /** Set when a mixed selection takes a typed expression such as `Mixed+2`. */
  relativeExpression?: ScrubRelativeExpression;
}

type FontSizeScrubIcon = (props: {
  className?: string;
  "aria-hidden"?: boolean;
}) => ReactNode;

export interface FontSizeFieldProps {
  label: string;
  value: number;
  onChange: (value: number, meta: FontSizeChangeMeta) => void;
  /**
   * Preset sizes listed in the menu and stepped through with the arrow keys.
   * Defaults to `FONT_SIZE_SCALE`.
   */
  scale?: readonly number[];
  /** Named sizes from a design system, listed below the scale. */
  namedSizes?: readonly FontSizeNamedSize[];
  namedSizesLabel?: string;
  openLabel: string;
  mixed?: boolean;
  mixedLabel: string;
  min?: number;
  max?: number;
  /** Accepted in typed input. */
  unit?: string;
  /**
   * Shown muted after the number. None by default: a font size is always
   * px, so a suffix only takes room.
   */
  displayUnit?: string;
  /** A leading handle that drags the size, as the inspector's scrub labels do. */
  scrubIcon?: FontSizeScrubIcon;
  scrubStep?: number;
  /**
   * Lets a mixed selection take an expression on its label (`Mixed+2`),
   * reported as `meta.relativeExpression` so each object changes by it.
   */
  allowRelativeExpressions?: boolean;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  contentProps?: Omit<
    ComponentPropsWithoutRef<typeof PopoverContent>,
    "children"
  > &
    Partial<Record<`data-${string}`, string>>;
}

function namedSizeKey(index: number) {
  return `named-${index}`;
}

const CUSTOM_SIZE_KEY = "size-custom";

function scaleSizeKey(size: number) {
  return `size-${size}`;
}

export function FontSizeField({
  label,
  value,
  onChange,
  scale = FONT_SIZE_SCALE,
  namedSizes = [],
  namedSizesLabel,
  openLabel,
  mixed = false,
  mixedLabel,
  min,
  max,
  unit,
  displayUnit = "",
  scrubIcon: ScrubIcon,
  scrubStep = 1,
  allowRelativeExpressions = false,
  disabled = false,
  className,
  inputClassName,
  contentProps,
}: FontSizeFieldProps) {
  const bounds: FontSizeBounds = {
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
  };
  const formatted = mixed ? mixedLabel : formatFontSize(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(formatted);
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurCommitRef = useRef(false);
  const [scrubValue, setScrubValue] = useState<number | null>(null);
  const scrubRef = useRef({
    pointerId: -1,
    drag: startScrubDrag(0),
    startValue: value,
    lastValue: value,
  });
  const unregisterScrubRef = useRef<(() => void) | null>(null);
  const cancelScrubRef = useRef<() => void>(() => {});
  const scaleSizes = [...new Set(scale)]
    .filter((size) => clampFontSize(size, bounds) === size)
    .sort((a, b) => a - b);
  // A size that is not on the scale is pinned above the list, checked, so
  // the current value is always visible when the list opens.
  const hasCustomSize = !mixed && !scaleSizes.includes(value);
  const currentKey = mixed
    ? ""
    : hasCustomSize
      ? CUSTOM_SIZE_KEY
      : scaleSizeKey(value);

  useEffect(
    () => () => {
      unregisterScrubRef.current?.();
    },
    [],
  );

  useEffect(() => {
    setScrubValue(null);
  }, [value]);

  const anchorSize =
    scaleSizes.find((size) => size >= FONT_SIZE_LIST_ANCHOR) ??
    scaleSizes.at(0);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const list =
        contentRef.current?.querySelector<HTMLElement>("[cmdk-list]");
      if (!list) return;
      const rows = list.querySelectorAll<HTMLElement>("[data-scale-size]");
      const anchorRow =
        anchorSize === undefined
          ? null
          : list.querySelector<HTMLElement>(
              `[data-scale-size="${anchorSize}"]`,
            );
      const lastRow = Array.from(rows).at(-1);
      if (anchorRow && lastRow) {
        // Layout offsets, not client rects: the popover opens with a scale
        // animation, and a measurement taken mid-animation lands half a row
        // off. The list is the rows' offset parent (it is positioned).
        const anchorTop = anchorRow.offsetTop;
        const lastBottom = lastRow.offsetTop + lastRow.offsetHeight;
        // The anchor row sits flush at the top so no sliver of the size
        // above it shows; the list's bottom padding stays below the last row.
        list.style.maxHeight = `${lastBottom - anchorTop + LIST_PADDING_PX}px`;
        list.scrollTop = anchorTop;
      }
      // jsdom has no Element.scrollIntoView.
      const current: Partial<Pick<Element, "scrollIntoView">> | null =
        list.querySelector('[cmdk-item][data-current="true"]');
      current?.scrollIntoView?.({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, anchorSize]);

  const commit = (next: number) => {
    setDraft(formatFontSize(next));
    if (mixed || next !== value) onChange(next, { phase: "commit" });
  };

  const commitRelativeDraft = () => {
    const expression = normalizeScrubMixedExpression(draft, mixedLabel);
    if (!expression) return false;
    const relative = parseScrubRelativeExpression(
      expression,
      value,
      { ...bounds, ...(unit ? { unit } : {}), precision: FONT_SIZE_PRECISION },
      mixedLabel,
    );
    if (!relative) return false;
    setDraft(mixedLabel);
    onChange(relative.value, {
      phase: "commit",
      relativeExpression: {
        expression,
        ...bounds,
        ...(unit ? { unit } : {}),
        precision: FONT_SIZE_PRECISION,
      },
    });
    return true;
  };

  const commitDraft = () => {
    if (mixed && draft === mixedLabel) return;
    if (mixed && allowRelativeExpressions && commitRelativeDraft()) return;
    const next = parseFontSizeInput(draft, value, {
      ...bounds,
      ...(unit ? { unit } : {}),
    });
    if (next === null) {
      setDraft(formatted);
      return;
    }
    commit(next);
  };

  const step = (direction: 1 | -1) => {
    const typed =
      mixed && draft === mixedLabel
        ? null
        : parseFontSizeInput(draft, value, {
            ...bounds,
            ...(unit ? { unit } : {}),
          });
    const next = stepFontSize(typed ?? value, scaleSizes, direction, bounds);
    if (next !== null) commit(next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && event.altKey) {
      event.preventDefault();
      setOpenState(true);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      step(event.key === "ArrowUp" ? 1 : -1);
      event.currentTarget.select();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      commitDraft();
      event.currentTarget.select();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(formatted);
      skipBlurCommitRef.current = true;
      event.currentTarget.blur();
    }
  };

  const setOpenState = (nextOpen: boolean) => {
    if (nextOpen) setActiveKey(currentKey);
    setOpen(nextOpen);
  };

  const pick = (next: number) => {
    setOpen(false);
    if (mixed || next !== value) onChange(next, { phase: "commit" });
  };

  const endScrub = (pointerId: number, element: Element | null) => {
    if (element?.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
    scrubRef.current.pointerId = -1;
    unregisterScrubRef.current?.();
    unregisterScrubRef.current = null;
  };

  const handleScrubPointerDown = (event: PointerEvent<HTMLSpanElement>) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    scrubRef.current = {
      pointerId: event.pointerId,
      drag: startScrubDrag(event.clientX),
      startValue: value,
      lastValue: value,
    };
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    unregisterScrubRef.current?.();
    unregisterScrubRef.current = registerActiveScrubInput(() =>
      cancelScrubRef.current(),
    );
    cancelScrubRef.current = () => {
      const { pointerId, drag, startValue } = scrubRef.current;
      if (pointerId === -1) return;
      endScrub(pointerId, handle);
      setScrubValue(null);
      if (!drag.hasDragged || mixed) return;
      onChange(startValue, { phase: "preview" });
      onChange(startValue, { phase: "cancel" });
    };
  };

  const handleScrubPointerMove = (event: PointerEvent<HTMLSpanElement>) => {
    const scrub = scrubRef.current;
    if (scrub.pointerId !== event.pointerId || mixed) return;
    const tick = updateScrubDrag(scrub.drag, event.clientX);
    scrub.drag = tick.state;
    if (tick.deltaX === null) return;
    const next = normalizeScrubNumber(
      roundScrubDragValue(
        scrub.lastValue + tick.deltaX * getScrubStepFromEvent(event, scrubStep),
        unit,
      ),
      { ...bounds, precision: FONT_SIZE_PRECISION },
    );
    if (!(next > 0) || next === scrub.lastValue) return;
    scrub.lastValue = next;
    setScrubValue(next);
    onChange(next, { phase: "preview" });
  };

  const handleScrubPointerUp = (event: PointerEvent<HTMLSpanElement>) => {
    const { pointerId, drag, startValue, lastValue } = scrubRef.current;
    if (pointerId !== event.pointerId) return;
    endScrub(pointerId, event.currentTarget);
    if (!drag.hasDragged) {
      inputRef.current?.focus();
      return;
    }
    if (mixed) return;
    if (lastValue === startValue) {
      setScrubValue(null);
      return;
    }
    onChange(lastValue, { phase: "commit" });
  };

  const handleScrubPointerCancel = (event: PointerEvent<HTMLSpanElement>) => {
    if (scrubRef.current.pointerId !== event.pointerId) return;
    cancelScrubRef.current();
  };

  const shown = editing
    ? draft
    : scrubValue !== null
      ? formatFontSize(scrubValue)
      : formatted;

  const { onOpenAutoFocus, className: contentClassName } = contentProps ?? {};

  return (
    <Popover open={open} onOpenChange={setOpenState}>
      <PopoverAnchor asChild>
        <InputGroup
          size="sm"
          data-font-size-field
          data-disabled={disabled}
          className={cn(
            // Focus recolors the field's own border instead of drawing a ring
            // outside it, which a scrolling toolbar row would clip.
            "h-6 has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-0 has-[[data-slot=input-group-control]:focus-visible]:ring-offset-0",
            className,
          )}
        >
          {ScrubIcon ? (
            <InputGroupAddon align="inline-start" className="gap-0 p-0">
              <span
                aria-hidden
                data-font-size-scrub
                onPointerDown={handleScrubPointerDown}
                onPointerMove={handleScrubPointerMove}
                onPointerUp={handleScrubPointerUp}
                onPointerCancel={handleScrubPointerCancel}
                // The group focuses its input on click; after a drag that
                // would start an edit holding the pre-drag size, which blur
                // then commits over the scrubbed one.
                onClick={(event) => event.stopPropagation()}
                className={cn(
                  "flex h-6 w-6 shrink-0 cursor-ew-resize touch-none select-none items-center justify-center text-muted-foreground transition-colors hover:text-foreground",
                  disabled && "pointer-events-none opacity-50",
                )}
              >
                <ScrubIcon className="size-3" aria-hidden={true} />
              </span>
            </InputGroupAddon>
          ) : null}
          <InputGroupInput
            ref={inputRef}
            value={shown}
            disabled={disabled}
            inputMode="decimal"
            aria-label={label}
            data-design-history-hotkeys="true"
            onFocus={(event) => {
              setDraft(formatted);
              setEditing(true);
              event.currentTarget.select();
            }}
            onBlur={() => {
              setEditing(false);
              if (skipBlurCommitRef.current) {
                skipBlurCommitRef.current = false;
                return;
              }
              commitDraft();
            }}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            className={cn(
              "w-0 min-w-0 px-1.5 !text-[11px] tabular-nums",
              ScrubIcon && "ps-0",
              mixed && !editing && "text-muted-foreground",
              inputClassName,
            )}
          />
          <InputGroupAddon align="inline-end" className="gap-0.5 py-0 pe-2">
            {displayUnit && !mixed ? (
              <InputGroupText aria-hidden className="!text-[11px]">
                {displayUnit}
              </InputGroupText>
            ) : null}
            <PopoverTrigger asChild>
              <InputGroupButton
                size="icon-xs"
                aria-label={openLabel}
                disabled={disabled}
                className="size-5 text-muted-foreground [&_svg]:size-3"
              >
                <IconChevronDown className="size-3" />
              </InputGroupButton>
            </PopoverTrigger>
          </InputGroupAddon>
        </InputGroup>
      </PopoverAnchor>
      <PopoverContent
        ref={contentRef}
        align="start"
        {...contentProps}
        className={cn(
          "w-[var(--radix-popover-trigger-width)] min-w-24 p-0",
          contentClassName,
        )}
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event);
          if (event.defaultPrevented) return;
          event.preventDefault();
          contentRef.current
            ?.querySelector<HTMLElement>("[cmdk-root]")
            ?.focus();
        }}
      >
        <Command
          value={activeKey}
          onValueChange={setActiveKey}
          shouldFilter={false}
          loop
          aria-label={openLabel}
        >
          {hasCustomSize ? (
            <>
              <div className="p-1">
                <CommandItem
                  value={CUSTOM_SIZE_KEY}
                  data-current="true"
                  onSelect={() => pick(value)}
                  className="cursor-pointer gap-2 py-1 ps-1.5 text-[11px] font-medium tabular-nums"
                >
                  <span className="flex size-3.5 shrink-0 items-center justify-center">
                    <IconCheck className="size-3.5" aria-hidden="true" />
                  </span>
                  {formatFontSize(value)}
                </CommandItem>
              </div>
              <CommandSeparator />
            </>
          ) : null}
          <CommandList className="relative max-h-64">
            <CommandGroup>
              {scaleSizes.map((size) => (
                <CommandItem
                  key={scaleSizeKey(size)}
                  value={scaleSizeKey(size)}
                  data-scale-size={size}
                  data-current={currentKey === scaleSizeKey(size)}
                  onSelect={() => pick(size)}
                  className="cursor-pointer gap-2 py-1 ps-1.5 text-[11px] tabular-nums data-[current=true]:font-medium"
                >
                  <span className="flex size-3.5 shrink-0 items-center justify-center">
                    {currentKey === scaleSizeKey(size) ? (
                      <IconCheck className="size-3.5" aria-hidden="true" />
                    ) : null}
                  </span>
                  {formatFontSize(size)}
                </CommandItem>
              ))}
            </CommandGroup>
            {namedSizes.length > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup
                  {...(namedSizesLabel ? { heading: namedSizesLabel } : {})}
                >
                  {namedSizes.map((size, index) => (
                    <CommandItem
                      key={namedSizeKey(index)}
                      value={namedSizeKey(index)}
                      data-current={currentKey === namedSizeKey(index)}
                      onSelect={() => pick(size.value)}
                      className="cursor-pointer justify-between gap-3 py-1 text-[11px] data-[current=true]:font-medium"
                    >
                      <span className="truncate">{size.label}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatFontSize(size.value)}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
