import {
  IconAlignCenter,
  IconAlignLeft,
  IconAlignRight,
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconMenu2,
  IconMinus,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  ANNOTATION_COLORS,
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  TEXT_FONTS,
  type Annotation,
  type MarkThickness,
  type TextAlign,
  type TextFontId,
} from "@/lib/screenshot-annotations";
import {
  DEFAULT_REDACTION_STYLE,
  DEFAULT_SOLID_FILL,
  SOLID_FILL_COLORS,
} from "@/lib/screenshot-redaction";
import { cn } from "@/lib/utils";

/** Where the selected mark is on screen, in viewport pixels. */
export interface ToolbarAnchor {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ElementToolbarProps {
  selected: Annotation;
  anchor: ToolbarAnchor;
  disabled: boolean;
  t: (key: string, vars?: Record<string, unknown>) => string;
  onChange: (change: Partial<Annotation>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** Text only: the size shown, and a way to set it. */
  textSize: number;
  onTextSize: (size: number) => void;
}

/** Gap between the mark and its toolbar. */
const GAP_PX = 10;

/**
 * The toolbar that belongs to one mark, shown next to it while it is selected
 * — the way Loom does it. The toolbar at the top only picks what to draw;
 * everything about a mark once it exists is changed here, beside it.
 *
 * Positioned in the viewport rather than in the picture, so a mark near the
 * edge still gets a whole toolbar: it sits below the mark, or above when
 * there is no room below, and is kept inside the window sideways.
 */
export function ElementToolbar({
  selected,
  anchor,
  disabled,
  t,
  onChange,
  onDuplicate,
  onDelete,
  textSize,
  onTextSize,
}: ElementToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    if (width !== size.width || height !== size.height)
      setSize({ width, height });
  });

  const viewportWidth = typeof window === "undefined" ? 0 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight;
  const below = anchor.top + anchor.height + GAP_PX;
  const top =
    below + size.height <= viewportHeight - 8
      ? below
      : Math.max(8, anchor.top - GAP_PX - size.height);
  const centre = anchor.left + anchor.width / 2;
  const left = Math.min(
    Math.max(8, centre - size.width / 2),
    Math.max(8, viewportWidth - size.width - 8),
  );

  const kindLabel = t(`screenshot.kind.${selected.kind}`);

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={t("screenshot.markToolbar", { kind: kindLabel })}
      // Everything here is a control, not the picture: a press must not start
      // drawing, deselect the mark or open the picture's own menu.
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      className="fixed z-40 flex items-center gap-0.5 rounded-xl bg-foreground p-1 text-background shadow-lg"
      style={{ left, top, visibility: size.width ? "visible" : "hidden" }}
    >
      {selected.kind === "redact" ? (
        <RedactionStyleControl
          selected={selected}
          disabled={disabled}
          t={t}
          onChange={onChange}
        />
      ) : (
        <ColourControl
          selected={selected}
          disabled={disabled}
          t={t}
          onChange={onChange}
        />
      )}

      {selected.kind === "box" || selected.kind === "arrow" ? (
        <ThicknessControl
          value={selected.thickness ?? "thin"}
          disabled={disabled}
          t={t}
          onChange={(thickness) =>
            onChange({ thickness } as Partial<Annotation>)
          }
        />
      ) : null}

      {selected.kind === "text" ? (
        <>
          <FontControl
            value={selected.font ?? "sans"}
            disabled={disabled}
            t={t}
            onChange={(font) => onChange({ font } as Partial<Annotation>)}
          />
          <TextSizeControl
            value={textSize}
            disabled={disabled}
            t={t}
            onChange={onTextSize}
          />
          <AlignControl
            value={selected.align ?? "left"}
            disabled={disabled}
            t={t}
            onChange={(align) => onChange({ align } as Partial<Annotation>)}
          />
        </>
      ) : null}

      <span className="mx-1 h-5 w-px bg-background/25" />
      <BarButton
        label={t("screenshot.duplicate", { kind: kindLabel })}
        disabled={disabled}
        onClick={onDuplicate}
      >
        <IconCopy className="size-4" />
      </BarButton>
      <BarButton
        label={t("screenshot.deleteMark")}
        disabled={disabled}
        onClick={onDelete}
      >
        <IconTrash className="size-4" />
      </BarButton>
    </div>
  );
}

function BarButton({
  label,
  children,
  className,
  ...rest
}: {
  label: string;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "flex h-8 items-center gap-1 rounded-lg px-2 text-sm transition-colors hover:bg-background/15 disabled:opacity-40 data-[state=open]:bg-background/20",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** A trigger that shows its current value and opens a menu or panel. */
function MenuTrigger({
  label,
  disabled,
  children,
  ...rest
}: {
  label: string;
  disabled: boolean;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <BarButton label={label} disabled={disabled} {...rest}>
      {children}
      <IconChevronDown className="size-3.5 opacity-70" />
    </BarButton>
  );
}

function Swatch({
  colour,
  active,
  onClick,
}: {
  colour: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={colour}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "size-7 rounded-md border transition-transform hover:scale-105",
        active
          ? "border-primary ring-2 ring-primary ring-offset-2 ring-offset-popover"
          : "border-border",
      )}
      style={{ backgroundColor: colour }}
    />
  );
}

function ColourControl({
  selected,
  disabled,
  t,
  onChange,
}: {
  selected: Exclude<Annotation, { kind: "redact" }>;
  disabled: boolean;
  t: ElementToolbarProps["t"];
  onChange: (change: Partial<Annotation>) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <MenuTrigger label={t("screenshot.colour")} disabled={disabled}>
          <span
            className="size-5 rounded-full border border-background/40"
            style={{ backgroundColor: selected.color }}
          />
        </MenuTrigger>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" sideOffset={8}>
        <div className="flex flex-wrap gap-2">
          {ANNOTATION_COLORS.map((colour) => (
            <Swatch
              key={colour}
              colour={colour}
              active={selected.color === colour}
              onClick={() => onChange({ color: colour } as Partial<Annotation>)}
            />
          ))}
        </div>
        {selected.kind === "box" ? (
          <div className="mt-3 flex items-center gap-5 text-sm">
            <label className="flex items-center gap-2">
              <Switch
                checked={Boolean(selected.fill)}
                onCheckedChange={(fill) =>
                  onChange({ fill } as Partial<Annotation>)
                }
              />
              {t("screenshot.fillBox")}
            </label>
            <label className="flex items-center gap-2">
              <Switch
                checked={Boolean(selected.shadow)}
                onCheckedChange={(shadow) =>
                  onChange({ shadow } as Partial<Annotation>)
                }
              />
              {t("screenshot.shadow")}
            </label>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function RedactionStyleControl({
  selected,
  disabled,
  t,
  onChange,
}: {
  selected: Extract<Annotation, { kind: "redact" }>;
  disabled: boolean;
  t: ElementToolbarProps["t"];
  onChange: (change: Partial<Annotation>) => void;
}) {
  const style = selected.style ?? DEFAULT_REDACTION_STYLE;
  const colour = selected.color ?? DEFAULT_SOLID_FILL;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <MenuTrigger label={t("screenshot.redactionStyle")} disabled={disabled}>
          {t(
            style === "mosaic" ? "redaction.styleBlur" : "redaction.styleSolid",
          )}
        </MenuTrigger>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" sideOffset={8}>
        <div className="flex gap-1">
          {(["mosaic", "solid"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={style === value}
              title={t(
                value === "mosaic"
                  ? "redaction.styleBlurHint"
                  : "redaction.styleSolidHint",
              )}
              onClick={() =>
                onChange({
                  style: value,
                  ...(value === "solid" ? { color: colour } : {}),
                } as Partial<Annotation>)
              }
              className={cn(
                "rounded-md px-3 py-1 text-sm",
                style === value
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(
                value === "mosaic"
                  ? "redaction.styleBlur"
                  : "redaction.styleSolid",
              )}
            </button>
          ))}
        </div>
        {style === "solid" ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {SOLID_FILL_COLORS.map((swatch) => (
              <Swatch
                key={swatch}
                colour={swatch}
                active={colour === swatch}
                onClick={() =>
                  onChange({ color: swatch } as Partial<Annotation>)
                }
              />
            ))}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function CheckItem({
  checked,
  onSelect,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="gap-3">
      {children}
      <IconCheck className={cn("ms-auto size-4", !checked && "invisible")} />
    </DropdownMenuItem>
  );
}

function ThicknessControl({
  value,
  disabled,
  t,
  onChange,
}: {
  value: MarkThickness;
  disabled: boolean;
  t: ElementToolbarProps["t"];
  onChange: (value: MarkThickness) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <MenuTrigger label={t("screenshot.thickness")} disabled={disabled}>
          <IconMenu2
            className={cn("size-4", value === "thick" && "stroke-[3]")}
          />
        </MenuTrigger>
      </DropdownMenuTrigger>
      <DropdownMenuContent sideOffset={8} className="min-w-36">
        {(["thin", "thick"] as const).map((option) => (
          <CheckItem
            key={option}
            checked={value === option}
            onSelect={() => onChange(option)}
          >
            <span
              className={cn(
                "rounded-full bg-current",
                option === "thin" ? "size-1.5" : "size-3",
              )}
            />
            {t(option === "thin" ? "screenshot.thin" : "screenshot.thick")}
          </CheckItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FontControl({
  value,
  disabled,
  t,
  onChange,
}: {
  value: TextFontId;
  disabled: boolean;
  t: ElementToolbarProps["t"];
  onChange: (value: TextFontId) => void;
}) {
  const current =
    TEXT_FONTS.find((entry) => entry.id === value) ?? TEXT_FONTS[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <MenuTrigger label={t("screenshot.textFont")} disabled={disabled}>
          <span style={{ fontFamily: current.family }}>{current.label}</span>
        </MenuTrigger>
      </DropdownMenuTrigger>
      <DropdownMenuContent sideOffset={8} className="min-w-40">
        {TEXT_FONTS.map((entry) => (
          <CheckItem
            key={entry.id}
            checked={entry.id === value}
            onSelect={() => onChange(entry.id)}
          >
            <span style={{ fontFamily: entry.family }}>{entry.label}</span>
          </CheckItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AlignControl({
  value,
  disabled,
  t,
  onChange,
}: {
  value: TextAlign;
  disabled: boolean;
  t: ElementToolbarProps["t"];
  onChange: (value: TextAlign) => void;
}) {
  const options = [
    ["left", IconAlignLeft, "screenshot.alignLeft"],
    ["center", IconAlignCenter, "screenshot.alignCenter"],
    ["right", IconAlignRight, "screenshot.alignRight"],
  ] as const;
  const CurrentIcon =
    options.find(([option]) => option === value)?.[1] ?? IconAlignLeft;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <MenuTrigger label={t("screenshot.align")} disabled={disabled}>
          <CurrentIcon className="size-4" />
        </MenuTrigger>
      </DropdownMenuTrigger>
      <DropdownMenuContent sideOffset={8} className="min-w-40">
        {options.map(([option, Icon, labelKey]) => (
          <CheckItem
            key={option}
            checked={value === option}
            onSelect={() => onChange(option)}
          >
            <Icon className="size-4" />
            {t(labelKey)}
          </CheckItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The font size: typed, or stepped with − and +. Typing is kept as text until
 * it is a usable number, so clearing the box to type a new size does not snap
 * it straight back.
 */
function TextSizeControl({
  value,
  disabled,
  t,
  onChange,
}: {
  value: number;
  disabled: boolean;
  t: ElementToolbarProps["t"];
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const apply = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    if (draft.trim() && Number.isFinite(parsed)) onChange(parsed);
    setDraft(null);
  };
  return (
    <div className="flex items-center" title={t("screenshot.textSizeHint")}>
      <BarButton
        label={t("screenshot.textSmaller")}
        disabled={disabled || value <= MIN_TEXT_SIZE}
        className="px-1.5"
        onClick={() => onChange(Math.min(value - 1, value * 0.9))}
      >
        <IconMinus className="size-3.5" />
      </BarButton>
      <input
        type="text"
        inputMode="numeric"
        aria-label={t("screenshot.textSize")}
        disabled={disabled}
        value={draft ?? String(value)}
        onChange={(event) =>
          setDraft(event.target.value.replace(/[^0-9]/g, ""))
        }
        onBlur={apply}
        onKeyDown={(event) => {
          if (event.key === "Enter") apply();
          if (event.key === "Escape") setDraft(null);
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            setDraft(null);
            onChange(value + (event.key === "ArrowUp" ? 1 : -1));
          }
        }}
        className="h-7 w-11 rounded-md border border-background/25 bg-transparent text-center text-sm tabular-nums outline-none focus:border-background/60"
      />
      <BarButton
        label={t("screenshot.textLarger")}
        disabled={disabled || value >= MAX_TEXT_SIZE}
        className="px-1.5"
        onClick={() => onChange(Math.max(value + 1, value * 1.1))}
      >
        <IconPlus className="size-3.5" />
      </BarButton>
    </div>
  );
}
