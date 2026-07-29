import { useT } from "@agent-native/core/client/i18n";
import { VisualColorPicker } from "@agent-native/toolkit/design-tweaks";
import type { DesignSystemData } from "@shared/api";
import {
  IconAlignCenter,
  IconAlignBoxBottomCenter,
  IconAlignBoxCenterMiddle,
  IconAlignBoxTopCenter,
  IconAlignJustified,
  IconAlignLeft,
  IconAlignRight,
  IconBorderRadius,
  IconBoxPadding,
  IconChevronDown,
  IconDroplet,
  IconLetterCase,
  IconRuler2,
  IconSpacingHorizontal,
  IconX,
} from "@tabler/icons-react";
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface SlideStyleSnapshot {
  selector: string;
  label: string;
  tagName: string;
  textPreview: string;
  isText: boolean;
  isImage: boolean;
  isAbsolute: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  slideWidth: number;
  slideHeight: number;
  color: string;
  backgroundColor: string;
  fontSize: number;
  fontWeight: string;
  lineHeight: number;
  textAlign: string;
  opacity: number;
  borderRadius: number;
  borderWidth: number;
  borderColor: string;
  paddingX: number;
  paddingY: number;
}

export type SlideStylePatch = Partial<{
  color: string;
  backgroundColor: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  textAlign: string;
  opacity: string;
  borderRadius: string;
  borderWidth: string;
  borderColor: string;
  paddingLeft: string;
  paddingRight: string;
  paddingTop: string;
  paddingBottom: string;
  left: string;
  top: string;
  width: string;
  height: string;
  transform: string;
}>;

function tokenPalette(
  designSystem: DesignSystemData | undefined,
  t: (key: string) => string,
) {
  const colors = designSystem?.colors;
  const base = colors
    ? [
        {
          label: t("styleInspector.primary"),
          value: colors.primary,
          color: colors.primary,
        },
        {
          label: t("styleInspector.secondary"),
          value: colors.secondary,
          color: colors.secondary,
        },
        {
          label: t("styleInspector.accent"),
          value: colors.accent,
          color: colors.accent,
        },
        {
          label: t("styleInspector.surface"),
          value: colors.surface,
          color: colors.surface,
        },
        {
          label: t("styleInspector.background"),
          value: colors.background,
          color: colors.background,
        },
        {
          label: t("styleInspector.text"),
          value: colors.text,
          color: colors.text,
        },
        {
          label: t("styleInspector.muted"),
          value: colors.textMuted,
          color: colors.textMuted,
        },
      ]
    : [];

  return [
    ...base,
    { label: t("styleInspector.white"), value: "#ffffff", color: "#ffffff" },
    { label: t("styleInspector.black"), value: "#000000", color: "#000000" },
    { label: t("styleInspector.slate"), value: "#1f2937", color: "#1f2937" },
    { label: t("styleInspector.blue"), value: "#609ff8", color: "#609ff8" },
    { label: t("styleInspector.cyan"), value: "#22d3ee", color: "#22d3ee" },
    {
      label: t("styleInspector.emerald"),
      value: "#34d399",
      color: "#34d399",
    },
    { label: t("styleInspector.amber"), value: "#fbbf24", color: "#fbbf24" },
    { label: t("styleInspector.rose"), value: "#fb7185", color: "#fb7185" },
  ];
}

function formatValue(value: number) {
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(2)));
}

function clamp(value: number, min?: number, max?: number) {
  return Math.min(
    max ?? Number.POSITIVE_INFINITY,
    Math.max(min ?? Number.NEGATIVE_INFINITY, value),
  );
}

function InspectorNumberField({
  label,
  value,
  onChange,
  unit = "px",
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [draft, setDraft] = useState(() => formatValue(value));
  const focusedRef = useRef(false);
  const scrubRef = useRef<{ startX: number; startValue: number } | null>(null);

  useEffect(() => {
    if (!focusedRef.current) setDraft(formatValue(value));
  }, [value]);

  const commit = (raw: string) => {
    const next = Number(raw);
    if (!Number.isFinite(next)) {
      setDraft(formatValue(value));
      return;
    }
    const constrained = clamp(next, min, max);
    setDraft(formatValue(constrained));
    if (constrained !== value) onChange(constrained);
  };

  return (
    <label className="group/field flex min-w-0 items-center gap-1.5">
      <span
        className="cursor-ew-resize select-none text-[11px] font-medium text-muted-foreground"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          scrubRef.current = { startX: event.clientX, startValue: value };
        }}
        onPointerMove={(event) => {
          const scrub = scrubRef.current;
          if (!scrub) return;
          const next = clamp(
            Math.round(
              (scrub.startValue +
                (event.clientX - scrub.startX) * step * 0.25) /
                step,
            ) * step,
            min,
            max,
          );
          setDraft(formatValue(next));
          if (next !== value) onChange(next);
        }}
        onPointerUp={() => {
          scrubRef.current = null;
        }}
      >
        {label}
      </span>
      <span className="flex min-w-0 flex-1 items-center rounded-sm bg-muted/70 px-1.5 focus-within:ring-1 focus-within:ring-ring">
        <Input
          aria-label={label}
          type="number"
          value={draft}
          min={min}
          max={max}
          step={step}
          onFocus={() => {
            focusedRef.current = true;
          }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            focusedRef.current = false;
            commit(draft);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setDraft(formatValue(value));
              event.currentTarget.blur();
            }
          }}
          className="h-6 min-w-0 border-0 bg-transparent px-0 text-right text-[11px] shadow-none outline-none focus-visible:ring-0 md:text-[11px]"
          data-inspector-field="true"
        />
        {unit ? (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function InspectorSection({
  title,
  icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const Icon = icon;
  return (
    <details className="group border-b border-border/60" open={defaultOpen}>
      <summary className="flex h-9 cursor-pointer list-none items-center justify-between px-3 text-[11px] font-medium text-foreground marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-1.5">
          <Icon className="size-3.5 text-muted-foreground" />
          {title}
        </span>
        <IconChevronDown className="size-3.5 text-muted-foreground transition-transform duration-150 ease-out group-open:rotate-180" />
      </summary>
      <div className="space-y-2 px-3 pb-3">{children}</div>
    </details>
  );
}

function AlignmentControl({
  label,
  value,
  onChange,
  orientation = "horizontal",
}: {
  label: string;
  value: "left" | "center" | "right";
  onChange: (value: "left" | "center" | "right") => void;
  orientation?: "horizontal" | "vertical";
}) {
  const labels =
    orientation === "horizontal"
      ? ["Align left", "Align center", "Align right"]
      : ["Align top", "Align middle", "Align bottom"];
  const icons =
    orientation === "horizontal"
      ? [IconAlignLeft, IconAlignCenter, IconAlignRight]
      : [
          IconAlignBoxTopCenter,
          IconAlignBoxCenterMiddle,
          IconAlignBoxBottomCenter,
        ];
  const options = [
    { value: "left" as const, label: labels[0], icon: icons[0] },
    { value: "center" as const, label: labels[1], icon: icons[1] },
    { value: "right" as const, label: labels[2], icon: icons[2] },
  ];
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      <span className="w-8 shrink-0 text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      <div className="grid flex-1 grid-cols-3 rounded-sm bg-muted/70 p-0.5">
        {options.map((option) => {
          const Icon = option.icon;
          const selected = value === option.value;
          return (
            <Button
              key={option.value}
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "h-6 rounded-[2px] text-muted-foreground hover:bg-background hover:text-foreground",
                selected && "bg-background text-foreground shadow-sm",
              )}
              aria-label={option.label}
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
            >
              <Icon className="size-3.5" />
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function rotationTransform(rotation: number) {
  return `rotate(${formatValue(rotation)}deg)`;
}

export function SlideStyleInspector({
  snapshot,
  designSystem,
  className,
  onChange,
  onClose,
}: {
  snapshot: SlideStyleSnapshot;
  designSystem?: DesignSystemData;
  className?: string;
  onChange: (patch: SlideStylePatch) => void;
  onClose: () => void;
}) {
  const t = useT();
  const palette = tokenPalette(designSystem, t);
  const documentColors = palette.map((option) => option.value);
  const targetLabel =
    snapshot.textPreview || snapshot.label || snapshot.tagName.toUpperCase();
  const horizontalAlignment =
    snapshot.x <= 0
      ? "left"
      : Math.abs(snapshot.x - (snapshot.slideWidth - snapshot.width) / 2) < 1
        ? "center"
        : "right";
  const verticalAlignment =
    snapshot.y <= 0
      ? "left"
      : Math.abs(snapshot.y - (snapshot.slideHeight - snapshot.height) / 2) < 1
        ? "center"
        : "right";

  const alignHorizontal = (alignment: "left" | "center" | "right") => {
    const available = Math.max(0, snapshot.slideWidth - snapshot.width);
    const x =
      alignment === "left"
        ? 0
        : alignment === "center"
          ? available / 2
          : available;
    onChange({
      left: `${formatValue(x)}px`,
    });
  };
  const alignVertical = (alignment: "left" | "center" | "right") => {
    const available = Math.max(0, snapshot.slideHeight - snapshot.height);
    const y =
      alignment === "left"
        ? 0
        : alignment === "center"
          ? available / 2
          : available;
    onChange({
      top: `${formatValue(y)}px`,
    });
  };

  return (
    <aside
      className={cn(
        "flex min-h-0 flex-col overflow-hidden bg-background",
        className,
      )}
      aria-label={t("styleInspector.title")}
    >
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border/70 px-3">
        <div className="min-w-0">
          <h2 className="text-[12px] font-semibold text-foreground">
            {t("styleInspector.title")}
          </h2>
          <p className="truncate text-[10px] text-muted-foreground">
            {targetLabel}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onClose}
          aria-label={t("styleInspector.close")}
          title={t("styleInspector.close")}
        >
          <IconX className="size-3.5" />
        </Button>
      </header>

      <div className="min-h-0 overflow-y-auto">
        {snapshot.isAbsolute ? (
          <InspectorSection title="Position" icon={IconSpacingHorizontal}>
            <AlignmentControl
              label="Horizontal"
              value={horizontalAlignment}
              onChange={alignHorizontal}
            />
            <AlignmentControl
              label="Vertical"
              value={verticalAlignment}
              onChange={alignVertical}
              orientation="vertical"
            />
            <div className="grid grid-cols-2 gap-2">
              <InspectorNumberField
                label="X"
                value={snapshot.x}
                onChange={(x) => onChange({ left: `${formatValue(x)}px` })}
              />
              <InspectorNumberField
                label="Y"
                value={snapshot.y}
                onChange={(y) => onChange({ top: `${formatValue(y)}px` })}
              />
            </div>
            <InspectorNumberField
              label="Rotation"
              value={snapshot.rotation}
              unit="°"
              min={-360}
              max={360}
              onChange={(rotation) =>
                onChange({ transform: rotationTransform(rotation) })
              }
            />
          </InspectorSection>
        ) : null}

        <InspectorSection title="Layout & dimensions" icon={IconRuler2}>
          <div className="grid grid-cols-2 gap-2">
            <InspectorNumberField
              label="W"
              value={snapshot.width}
              min={0}
              onChange={(width) =>
                onChange({ width: `${formatValue(width)}px` })
              }
            />
            <InspectorNumberField
              label="H"
              value={snapshot.height}
              min={0}
              onChange={(height) =>
                onChange({ height: `${formatValue(height)}px` })
              }
            />
          </div>
        </InspectorSection>

        <InspectorSection title="Appearance" icon={IconBorderRadius}>
          <div className="grid grid-cols-2 gap-2">
            <InspectorNumberField
              label="Opacity"
              value={snapshot.opacity}
              unit="%"
              min={0}
              max={100}
              step={5}
              onChange={(opacity) =>
                onChange({ opacity: String(opacity / 100) })
              }
            />
            <InspectorNumberField
              label="Radius"
              value={snapshot.borderRadius}
              min={0}
              max={96}
              onChange={(radius) =>
                onChange({ borderRadius: `${formatValue(radius)}px` })
              }
            />
          </div>
        </InspectorSection>

        <InspectorSection
          title={snapshot.isImage ? "Tint" : "Fill"}
          icon={IconDroplet}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">
              Color
            </span>
            <VisualColorPicker
              label={snapshot.isImage ? "Tint" : "Fill"}
              value={snapshot.backgroundColor}
              documentColors={documentColors}
              allowTransparent
              onChange={(value) => onChange({ backgroundColor: value })}
            />
          </div>
        </InspectorSection>

        <InspectorSection
          title="Stroke"
          icon={IconBorderRadius}
          defaultOpen={false}
        >
          <div className="grid grid-cols-2 gap-2">
            <InspectorNumberField
              label="Weight"
              value={snapshot.borderWidth}
              min={0}
              max={16}
              onChange={(width) =>
                onChange({ borderWidth: `${formatValue(width)}px` })
              }
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">
              Color
            </span>
            <VisualColorPicker
              label="Stroke color"
              value={snapshot.borderColor}
              documentColors={documentColors}
              onChange={(value) => onChange({ borderColor: value })}
            />
          </div>
        </InspectorSection>

        {snapshot.isText ? (
          <InspectorSection title="Typography" icon={IconLetterCase}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-muted-foreground">
                Color
              </span>
              <VisualColorPicker
                label="Text color"
                value={snapshot.color}
                documentColors={documentColors}
                onChange={(value) => onChange({ color: value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <InspectorNumberField
                label="Size"
                value={snapshot.fontSize}
                min={8}
                max={160}
                onChange={(fontSize) =>
                  onChange({ fontSize: `${formatValue(fontSize)}px` })
                }
              />
              <InspectorNumberField
                label="Line"
                value={snapshot.lineHeight}
                unit=""
                min={0.8}
                max={3}
                step={0.05}
                onChange={(lineHeight) =>
                  onChange({ lineHeight: formatValue(lineHeight) })
                }
              />
            </div>
            <div
              className="grid grid-cols-4 rounded-sm bg-muted/70 p-0.5"
              role="group"
              aria-label="Font weight"
            >
              {["400", "500", "600", "700"].map((weight) => (
                <Button
                  key={weight}
                  type="button"
                  variant="ghost"
                  className={cn(
                    "h-6 rounded-[2px] px-1 text-[10px] text-muted-foreground hover:bg-background hover:text-foreground",
                    snapshot.fontWeight === weight &&
                      "bg-background text-foreground shadow-sm",
                  )}
                  aria-label={`Font weight ${weight}`}
                  aria-pressed={snapshot.fontWeight === weight}
                  onClick={() => onChange({ fontWeight: weight })}
                >
                  {weight}
                </Button>
              ))}
            </div>
            <div
              className="grid grid-cols-4 rounded-sm bg-muted/70 p-0.5"
              role="group"
              aria-label="Text alignment"
            >
              {[
                {
                  value: "left",
                  label: "Align text left",
                  icon: IconAlignLeft,
                },
                {
                  value: "center",
                  label: "Align text center",
                  icon: IconAlignCenter,
                },
                {
                  value: "right",
                  label: "Align text right",
                  icon: IconAlignRight,
                },
                {
                  value: "justify",
                  label: "Justify text",
                  icon: IconAlignJustified,
                },
              ].map((option) => {
                const Icon = option.icon;
                return (
                  <Button
                    key={option.value}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-6 rounded-[2px] text-muted-foreground hover:bg-background hover:text-foreground",
                      snapshot.textAlign === option.value &&
                        "bg-background text-foreground shadow-sm",
                    )}
                    aria-label={option.label}
                    aria-pressed={snapshot.textAlign === option.value}
                    onClick={() => onChange({ textAlign: option.value })}
                  >
                    <Icon className="size-3.5" />
                  </Button>
                );
              })}
            </div>
          </InspectorSection>
        ) : null}

        {!snapshot.isImage ? (
          <InspectorSection
            title="Spacing"
            icon={IconBoxPadding}
            defaultOpen={false}
          >
            <div className="grid grid-cols-2 gap-2">
              <InspectorNumberField
                label="Horizontal"
                value={snapshot.paddingX}
                min={0}
                max={120}
                step={2}
                onChange={(padding) =>
                  onChange({
                    paddingLeft: `${formatValue(padding)}px`,
                    paddingRight: `${formatValue(padding)}px`,
                  })
                }
              />
              <InspectorNumberField
                label="Vertical"
                value={snapshot.paddingY}
                min={0}
                max={120}
                step={2}
                onChange={(padding) =>
                  onChange({
                    paddingTop: `${formatValue(padding)}px`,
                    paddingBottom: `${formatValue(padding)}px`,
                  })
                }
              />
            </div>
          </InspectorSection>
        ) : null}
      </div>
    </aside>
  );
}
