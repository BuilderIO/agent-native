import { IconAssembly, IconChevronDown } from "@tabler/icons-react";
import { useState, type CSSProperties, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { InlinePaintField } from "./color-picker-fields";
import { UNRESOLVED_SWATCH_CLASS } from "./color-picker-swatch";
import {
  fillFieldEditText,
  parseFillFieldDraft,
  type FillFieldReading,
} from "./fill-field-reading";

/** The 14px swatch at the start of a Fill field: the color, the paint, or a hatch for a token that cannot be shown. */
export function FillFieldSwatch({
  style,
  unresolved = false,
  className,
}: {
  style?: CSSProperties;
  unresolved?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "size-3.5 shrink-0 rounded-[3px] border border-border/60",
        unresolved && UNRESOLVED_SWATCH_CLASS,
        className,
      )}
      style={unresolved ? undefined : style}
    />
  );
}

export function FillFieldChevron({ className }: { className?: string }) {
  return (
    <IconChevronDown
      aria-hidden="true"
      className={cn("size-3 shrink-0 text-muted-foreground", className)}
    />
  );
}

/** A token's name in its chip; an unresolved token keeps its name but not the accent. */
function TokenChip({
  name,
  unresolved,
}: {
  name: string;
  unresolved: boolean;
}) {
  return (
    <span
      className={cn(
        "flex h-[18px] min-w-0 shrink items-center gap-1 rounded-sm px-1.5 !text-[11px] font-medium",
        unresolved
          ? "bg-muted text-muted-foreground"
          : "bg-primary/10 text-primary",
      )}
    >
      <IconAssembly aria-hidden="true" className="size-3 shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  );
}

/**
 * The reading of a Fill field when it is not typed into: hex in capitals, the
 * Display P3 or OKLCH numbers behind a muted name, a CSS color as written, a
 * paint by its name, a token in its chip. Long readings end in an ellipsis.
 */
export function FillFieldReadingText({
  reading,
  mixedLabel,
}: {
  reading: FillFieldReading;
  mixedLabel: string;
}) {
  switch (reading.kind) {
    case "token":
      return (
        <>
          <TokenChip name={reading.name} unresolved={reading.unresolved} />
          <span className="flex-1" />
        </>
      );
    case "wide":
      return (
        <span className="min-w-0 flex-1 truncate text-left tabular-nums tracking-[-0.03em]">
          <span className="text-muted-foreground">{reading.prefix}</span>{" "}
          {reading.text}
        </span>
      );
    case "mixed":
      return (
        <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">
          {mixedLabel}
        </span>
      );
    default:
      return (
        <span className="min-w-0 flex-1 truncate text-left tabular-nums">
          {reading.text}
        </span>
      );
  }
}

/**
 * A Fill field's face inside its trigger: swatch, reading, opacity, chevron.
 * The opacity is left out where the reading takes its room (Display P3 and
 * OKLCH at 100%).
 */
export function FillFieldFace({
  reading,
  swatch,
  opacity,
  mixedLabel,
  trailing,
  chevron = true,
}: {
  reading: FillFieldReading;
  swatch: ReactNode;
  /** Spelled out after the reading; null leaves it out. */
  opacity: number | null;
  mixedLabel: string;
  trailing?: ReactNode;
  /** Off where the row has no room to spare for it. */
  chevron?: boolean;
}) {
  return (
    <>
      {swatch}
      <FillFieldReadingText reading={reading} mixedLabel={mixedLabel} />
      {opacity !== null && (
        <span className="shrink-0 tabular-nums text-muted-foreground !text-[11px]">
          {opacity}%
        </span>
      )}
      {trailing}
      {chevron && <FillFieldChevron />}
    </>
  );
}

/**
 * A solid Fill field you type into. Hex and CSS colors are typed in place;
 * Display P3 and OKLCH show their muted name and numbers until you click, then
 * open as one line of text. Enter commits, Escape puts the reading back.
 */
export function FillFieldText({
  reading,
  alpha,
  ariaLabel,
  disabled,
  onCommit,
}: {
  reading: FillFieldReading;
  /** The fill's opacity as 0..1, kept when the text does not carry its own. */
  alpha: number;
  ariaLabel: string;
  disabled: boolean;
  /** The CSS the typed text stands for. */
  onCommit: (css: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const text = fillFieldEditText(reading) ?? "";
  const wide = reading.kind === "wide";
  const hex = reading.kind === "hex";

  if (wide && !editing) {
    return (
      <button
        type="button"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setEditing(true)}
        className="min-w-0 flex-1 cursor-text truncate text-left tabular-nums tracking-[-0.03em] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
      >
        <FillFieldReadingText reading={reading} mixedLabel="" />
      </button>
    );
  }
  return (
    <InlinePaintField
      ariaLabel={ariaLabel}
      value={text}
      disabled={disabled}
      uppercase={hex}
      className={cn("min-w-0 flex-1", hex && "uppercase")}
      autoFocus={editing}
      onEnd={() => setEditing(false)}
      parse={(draft) => parseFillFieldDraft(draft, alpha)}
      onCommit={onCommit}
    />
  );
}
