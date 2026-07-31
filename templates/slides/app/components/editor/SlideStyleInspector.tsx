import { useT } from "@agent-native/core/client/i18n";
import {
  VisualColorPicker,
  VisualControlRow,
  VisualInspectorPanel,
  VisualInspectorSection,
  VisualScrubInput,
  VisualSegmentedControl,
} from "@agent-native/toolkit/design-tweaks";
import type { DesignSystemData } from "@shared/api";
import {
  IconAngle,
  IconArrowAutofitHeight,
  IconArrowAutofitWidth,
  IconBorderRadius,
  IconBorderStyle,
  IconBoxPadding,
  IconDroplet,
  IconGridDots,
  IconLetterCase,
  IconRuler2,
  IconSpacingHorizontal,
  IconSpacingVertical,
  IconStackBack,
  IconStackFront,
  IconX,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { InlineTextStyleKey } from "./rich-text-selection";

export interface SlideStyleSnapshot {
  /** Omitted snapshots are existing object snapshots for backward compatibility. */
  mode?: "object";
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
  zIndex: number;
  textStyleScope?: "block" | "selection";
  mixedTextStyles?: InlineTextStyleKey[];
}

/**
 * Slide backgrounds are a surface, rather than selectable canvas objects.
 * The editor passes this mode while its Style panel is open without an object
 * selection, so the inspector exposes only background-safe controls.
 */
export interface SlideBackgroundStyleSnapshot {
  mode: "background";
  backgroundColor: string;
}

export type SlideStyleInspectorSnapshot =
  | SlideStyleSnapshot
  | SlideBackgroundStyleSnapshot;

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
  zIndex: string;
}>;

export type SlideBackgroundStylePatch = Required<
  Pick<SlideStylePatch, "backgroundColor">
>;

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

// `slide.background` holds either a raw CSS value or a Tailwind arbitrary
// class (`bg-[#000000]`), which SlideRenderer applies as a class rather than
// an inline style. The picker only speaks CSS colors, so unwrap the arbitrary
// form and report anything else (named utilities, gradients) as unreadable
// rather than guessing a hex the slide is not actually using.
function backgroundCssValue(background: string | undefined): string | null {
  // SlideRenderer's own fallback when the field is unset.
  if (!background) return "#000000";
  const arbitrary = background.match(/^bg-\[(.+)\]$/);
  if (arbitrary) return arbitrary[1].replace(/_/g, " ");
  return background.startsWith("bg-") ? null : background;
}

/**
 * Rendered in the style dock when no element is selected — otherwise the
 * slide's own background is unreachable from the editor UI.
 */
export function SlideBackgroundInspector({
  background,
  designSystem,
  className,
  onChange,
  onClose,
}: {
  background: string | undefined;
  designSystem?: DesignSystemData;
  className?: string;
  onChange: (background: string) => void;
  onClose?: () => void;
}) {
  const t = useT();
  const documentColors = tokenPalette(designSystem, t).map(
    (option) => option.value,
  );
  const solid = backgroundCssValue(background);

  return (
    <VisualInspectorPanel
      title={t("styleInspector.title")}
      subtitle={t("styleInspector.slide")}
      className={className}
      headerAction={
        onClose ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 cursor-pointer text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label={t("styleInspector.close")}
          >
            <IconX className="size-3.5" />
          </Button>
        ) : undefined
      }
    >
      <VisualInspectorSection
        title={
          <span className="inline-flex items-center gap-1.5">
            <IconDroplet className="size-3" />
            {t("styleInspector.slideBackground")}
          </span>
        }
      >
        <VisualControlRow label={t("styleInspector.background")}>
          <VisualColorPicker
            label={t("styleInspector.slideBackground")}
            value={solid ?? "#000000"}
            mixed={solid === null}
            mixedLabel={t("styleInspector.mixed")}
            documentColors={documentColors}
            onChange={onChange}
          />
        </VisualControlRow>
      </VisualInspectorSection>
    </VisualInspectorPanel>
  );
}

function formatValue(value: number) {
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(2)));
}

function rotationTransform(rotation: number) {
  return `rotate(${formatValue(rotation)}deg)`;
}

export function SlideStyleInspector({
  snapshot,
  designSystem,
  className,
  onChange,
  onArrange,
  onClose,
}: {
  snapshot: SlideStyleInspectorSnapshot;
  designSystem?: DesignSystemData;
  className?: string;
  onChange: (patch: SlideStylePatch) => void;
  /** Bring-to-front / send-to-back for the selected freeform object. Omitted
   *  (or the snapshot not being a freeform object) hides the Arrange row. */
  onArrange?: (target: "front" | "back") => void;
  onClose: () => void;
}) {
  const t = useT();
  const palette = tokenPalette(designSystem, t);
  const documentColors = palette.map((option) => option.value);
  const inlineEditSurfaceProps = {
    "data-slide-inline-edit-surface": "true",
  };
  const inspectorClassName = cn(
    "slide-style-inspector h-full w-full rounded-none border-0 bg-transparent text-foreground shadow-none backdrop-blur-none",
    className,
  );
  const headerAction = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
      onClick={onClose}
      aria-label={t("styleInspector.close")}
    >
      <IconX className="size-3.5" />
    </Button>
  );

  if (snapshot.mode === "background") {
    return (
      <VisualInspectorPanel
        title={t("styleInspector.title")}
        subtitle={t("styleInspector.background")}
        className={inspectorClassName}
        headerAction={headerAction}
      >
        <VisualInspectorSection
          title={
            <span className="inline-flex items-center gap-1.5">
              <IconDroplet className="size-3.5" />
              {t("styleInspector.fill")}
            </span>
          }
          className="slides-inspector-section"
        >
          <VisualControlRow
            label={t("styleInspector.color")}
            className="slides-inspector-control"
          >
            <VisualColorPicker
              label={t("styleInspector.fill")}
              value={snapshot.backgroundColor}
              documentColors={documentColors}
              allowTransparent
              variant="filled"
              className="rounded-sm bg-[var(--slides-inspector-control-background)] hover:bg-[var(--slides-inspector-control-background)]"
              contentProps={inlineEditSurfaceProps}
              onChange={(value) => onChange({ backgroundColor: value })}
            />
          </VisualControlRow>
        </VisualInspectorSection>
      </VisualInspectorPanel>
    );
  }

  const mixedTextStyles = snapshot.mixedTextStyles ?? [];
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
      ? "top"
      : Math.abs(snapshot.y - (snapshot.slideHeight - snapshot.height) / 2) < 1
        ? "middle"
        : "bottom";

  const alignHorizontal = (alignment: string) => {
    const available = Math.max(0, snapshot.slideWidth - snapshot.width);
    const x =
      alignment === "left"
        ? 0
        : alignment === "center"
          ? available / 2
          : available;
    onChange({ left: `${formatValue(x)}px` });
  };
  const alignVertical = (alignment: string) => {
    const available = Math.max(0, snapshot.slideHeight - snapshot.height);
    const y =
      alignment === "top"
        ? 0
        : alignment === "middle"
          ? available / 2
          : available;
    onChange({ top: `${formatValue(y)}px` });
  };

  return (
    <VisualInspectorPanel
      title={t("styleInspector.title")}
      subtitle={targetLabel}
      className={inspectorClassName}
      headerAction={headerAction}
    >
      {snapshot.isAbsolute ? (
        <VisualInspectorSection
          title={
            <span className="inline-flex items-center gap-1.5">
              <IconSpacingHorizontal className="size-3.5" />
              {t("styleInspector.position")}
            </span>
          }
          className="slides-inspector-section"
        >
          <VisualControlRow
            label={t("styleInspector.horizontal")}
            className="slides-inspector-control"
          >
            <VisualSegmentedControl
              value={horizontalAlignment}
              onChange={alignHorizontal}
              className="slides-inspector-segment"
              options={[
                { label: t("styleInspector.left"), value: "left" },
                { label: t("styleInspector.center"), value: "center" },
                { label: t("styleInspector.right"), value: "right" },
              ]}
            />
          </VisualControlRow>
          <VisualControlRow
            label={t("styleInspector.vertical")}
            className="slides-inspector-control"
          >
            <VisualSegmentedControl
              value={verticalAlignment}
              onChange={alignVertical}
              className="slides-inspector-segment"
              options={[
                { label: t("styleInspector.top"), value: "top" },
                { label: t("styleInspector.middle"), value: "middle" },
                { label: t("styleInspector.bottom"), value: "bottom" },
              ]}
            />
          </VisualControlRow>
          <div className="grid grid-cols-2 gap-2">
            <VisualScrubInput
              label={t("styleInspector.x")}
              icon={null}
              labelClassName="w-8 justify-center"
              value={snapshot.x}
              unit="px"
              onChange={(x) => onChange({ left: `${formatValue(x)}px` })}
            />
            <VisualScrubInput
              label={t("styleInspector.y")}
              icon={null}
              labelClassName="w-8 justify-center"
              value={snapshot.y}
              unit="px"
              onChange={(y) => onChange({ top: `${formatValue(y)}px` })}
            />
          </div>
          <VisualScrubInput
            label={t("styleInspector.rotation")}
            icon={IconAngle}
            prefix="icon"
            value={snapshot.rotation}
            min={-360}
            max={360}
            unit="°"
            onChange={(rotation) =>
              onChange({ transform: rotationTransform(rotation) })
            }
          />
        </VisualInspectorSection>
      ) : null}

      {snapshot.isAbsolute && onArrange ? (
        <VisualInspectorSection
          title={
            <span className="inline-flex items-center gap-1.5">
              <IconStackFront className="size-3.5" />
              {t("styleInspector.arrange")}
            </span>
          }
          className="slides-inspector-section"
        >
          <VisualControlRow
            label={t("styleInspector.order")}
            className="slides-inspector-control"
          >
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 cursor-pointer rounded-sm bg-[var(--slides-inspector-control-background)] text-muted-foreground hover:bg-[var(--slides-inspector-control-background)] hover:text-foreground"
                onClick={() => onArrange("back")}
                aria-label={t("styleInspector.sendToBack")}
              >
                <IconStackBack className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 cursor-pointer rounded-sm bg-[var(--slides-inspector-control-background)] text-muted-foreground hover:bg-[var(--slides-inspector-control-background)] hover:text-foreground"
                onClick={() => onArrange("front")}
                aria-label={t("styleInspector.bringToFront")}
              >
                <IconStackFront className="size-3.5" />
              </Button>
            </div>
          </VisualControlRow>
        </VisualInspectorSection>
      ) : null}

      <VisualInspectorSection
        title={
          <span className="inline-flex items-center gap-1.5">
            <IconRuler2 className="size-3.5" />
            {t("styleInspector.layoutDimensions")}
          </span>
        }
        className="slides-inspector-section"
      >
        <div className="grid grid-cols-2 gap-2">
          <VisualScrubInput
            label={t("styleInspector.width")}
            icon={IconArrowAutofitWidth}
            prefix="icon"
            value={snapshot.width}
            min={0}
            unit="px"
            onChange={(width) => onChange({ width: `${formatValue(width)}px` })}
          />
          <VisualScrubInput
            label={t("styleInspector.height")}
            icon={IconArrowAutofitHeight}
            prefix="icon"
            value={snapshot.height}
            min={0}
            unit="px"
            onChange={(height) =>
              onChange({ height: `${formatValue(height)}px` })
            }
          />
        </div>
      </VisualInspectorSection>

      <VisualInspectorSection
        title={
          <span className="inline-flex items-center gap-1.5">
            <IconBorderRadius className="size-3.5" />
            {t("styleInspector.appearance")}
          </span>
        }
        className="slides-inspector-section"
      >
        <div className="grid grid-cols-2 gap-2">
          <VisualScrubInput
            label={t("styleInspector.opacity")}
            icon={IconGridDots}
            prefix="icon"
            value={snapshot.opacity}
            min={0}
            max={100}
            step={5}
            unit="%"
            onChange={(opacity) => onChange({ opacity: String(opacity / 100) })}
          />
          <VisualScrubInput
            label={t("styleInspector.cornerRadius")}
            icon={IconBorderRadius}
            prefix="icon"
            value={snapshot.borderRadius}
            min={0}
            max={96}
            unit="px"
            onChange={(radius) =>
              onChange({ borderRadius: `${formatValue(radius)}px` })
            }
          />
        </div>
      </VisualInspectorSection>

      <VisualInspectorSection
        title={
          <span className="inline-flex items-center gap-1.5">
            <IconDroplet className="size-3.5" />
            {snapshot.isImage
              ? t("styleInspector.tint")
              : t("styleInspector.fill")}
          </span>
        }
        className="slides-inspector-section"
      >
        <VisualControlRow
          label={t("styleInspector.color")}
          className="slides-inspector-control"
        >
          <VisualColorPicker
            label={
              snapshot.isImage
                ? t("styleInspector.tint")
                : t("styleInspector.fill")
            }
            value={snapshot.backgroundColor}
            documentColors={documentColors}
            allowTransparent
            variant="filled"
            className="rounded-sm bg-[var(--slides-inspector-control-background)] hover:bg-[var(--slides-inspector-control-background)]"
            contentProps={inlineEditSurfaceProps}
            onChange={(value) => onChange({ backgroundColor: value })}
          />
        </VisualControlRow>
      </VisualInspectorSection>

      <VisualInspectorSection
        title={
          <span className="inline-flex items-center gap-1.5">
            <IconBorderRadius className="size-3.5" />
            {t("styleInspector.stroke")}
          </span>
        }
        className="slides-inspector-section"
      >
        <VisualScrubInput
          label={t("styleInspector.strokeWeight")}
          icon={IconBorderStyle}
          prefix="icon"
          value={snapshot.borderWidth}
          min={0}
          max={16}
          unit="px"
          onChange={(width) =>
            onChange({ borderWidth: `${formatValue(width)}px` })
          }
        />
        <VisualControlRow
          label={t("styleInspector.strokeColor")}
          className="slides-inspector-control"
        >
          <VisualColorPicker
            label={t("styleInspector.strokeColor")}
            value={snapshot.borderColor}
            documentColors={documentColors}
            variant="filled"
            className="rounded-sm bg-[var(--slides-inspector-control-background)] hover:bg-[var(--slides-inspector-control-background)]"
            contentProps={inlineEditSurfaceProps}
            onChange={(value) => onChange({ borderColor: value })}
          />
        </VisualControlRow>
      </VisualInspectorSection>

      {snapshot.isText ? (
        <VisualInspectorSection
          title={
            <span className="inline-flex items-center gap-1.5">
              <IconLetterCase className="size-3.5" />
              {t("styleInspector.typography")}
            </span>
          }
          className="slides-inspector-section"
        >
          <VisualControlRow
            label={t("styleInspector.color")}
            className="slides-inspector-control"
          >
            <VisualColorPicker
              label={t("styleInspector.textColor")}
              value={snapshot.color}
              documentColors={documentColors}
              mixed={mixedTextStyles.includes("color")}
              mixedLabel={t("styleInspector.mixed")}
              variant="filled"
              className="rounded-sm bg-[var(--slides-inspector-control-background)] hover:bg-[var(--slides-inspector-control-background)]"
              contentProps={inlineEditSurfaceProps}
              onChange={(value) => onChange({ color: value })}
            />
          </VisualControlRow>
          <div className="grid grid-cols-2 gap-2">
            <VisualScrubInput
              label={t("styleInspector.size")}
              icon={IconLetterCase}
              prefix="icon"
              value={snapshot.fontSize}
              min={8}
              max={160}
              unit="px"
              mixed={mixedTextStyles.includes("fontSize")}
              mixedLabel={t("styleInspector.mixed")}
              onChange={(fontSize) =>
                onChange({ fontSize: `${formatValue(fontSize)}px` })
              }
            />
            <VisualScrubInput
              label={t("styleInspector.line")}
              icon={IconArrowAutofitHeight}
              prefix="icon"
              value={snapshot.lineHeight}
              min={0.8}
              max={3}
              step={0.05}
              onChange={(lineHeight) =>
                onChange({ lineHeight: formatValue(lineHeight) })
              }
            />
          </div>
          <VisualSegmentedControl
            value={
              mixedTextStyles.includes("fontWeight")
                ? null
                : snapshot.fontWeight
            }
            onChange={(fontWeight) => onChange({ fontWeight })}
            className="slides-inspector-segment"
            options={[
              { label: t("styleInspector.regular"), value: "400" },
              { label: t("styleInspector.medium"), value: "500" },
              { label: t("styleInspector.semi"), value: "600" },
              { label: t("styleInspector.bold"), value: "700" },
            ]}
          />
          <VisualSegmentedControl
            value={snapshot.textAlign}
            onChange={(textAlign) => onChange({ textAlign })}
            className="slides-inspector-segment"
            options={[
              { label: t("styleInspector.left"), value: "left" },
              { label: t("styleInspector.center"), value: "center" },
              { label: t("styleInspector.right"), value: "right" },
              { label: t("styleInspector.justify"), value: "justify" },
            ]}
          />
        </VisualInspectorSection>
      ) : null}

      {!snapshot.isImage ? (
        <VisualInspectorSection
          title={
            <span className="inline-flex items-center gap-1.5">
              <IconBoxPadding className="size-3.5" />
              {t("styleInspector.spacing")}
            </span>
          }
          className="slides-inspector-section"
        >
          <div className="grid grid-cols-2 gap-2">
            <VisualScrubInput
              label={t("styleInspector.horizontal")}
              icon={IconSpacingHorizontal}
              prefix="icon"
              value={snapshot.paddingX}
              min={0}
              max={120}
              step={2}
              unit="px"
              onChange={(padding) =>
                onChange({
                  paddingLeft: `${formatValue(padding)}px`,
                  paddingRight: `${formatValue(padding)}px`,
                })
              }
            />
            <VisualScrubInput
              label={t("styleInspector.vertical")}
              icon={IconSpacingVertical}
              prefix="icon"
              value={snapshot.paddingY}
              min={0}
              max={120}
              step={2}
              unit="px"
              onChange={(padding) =>
                onChange({
                  paddingTop: `${formatValue(padding)}px`,
                  paddingBottom: `${formatValue(padding)}px`,
                })
              }
            />
          </div>
        </VisualInspectorSection>
      ) : null}
    </VisualInspectorPanel>
  );
}
