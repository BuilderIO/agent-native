import {
  useT,
  VisualColorPicker,
  VisualControlRow,
  VisualInspectorPanel,
  VisualInspectorSection,
  VisualScrubInput,
  VisualSegmentedControl,
} from "@agent-native/core/client";
import type { DesignSystemData } from "@shared/api";
import {
  IconAlignCenter,
  IconAlignJustified,
  IconAlignLeft,
  IconAlignRight,
  IconBorderRadius,
  IconBoxPadding,
  IconDroplet,
  IconLetterCase,
  IconX,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";

export interface SlideStyleSnapshot {
  selector: string;
  label: string;
  tagName: string;
  textPreview: string;
  isText: boolean;
  isImage: boolean;
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

  return (
    <VisualInspectorPanel
      title={t("styleInspector.title")}
      subtitle={targetLabel}
      className={className}
      headerAction={
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
      }
    >
      {snapshot.isText && (
        <VisualInspectorSection
          title={
            <span className="inline-flex items-center gap-1.5">
              <IconLetterCase className="size-3" />
              {t("styleInspector.type")}
            </span>
          }
        >
          <VisualControlRow label={t("styleInspector.color")}>
            <VisualColorPicker
              label={t("styleInspector.color")}
              value={snapshot.color}
              documentColors={documentColors}
              onChange={(value) => onChange({ color: value })}
            />
          </VisualControlRow>
          <div className="grid grid-cols-2 gap-2">
            <VisualScrubInput
              label={t("styleInspector.size")}
              value={snapshot.fontSize}
              min={8}
              max={160}
              step={1}
              unit="px"
              onChange={(value) => onChange({ fontSize: `${value}px` })}
            />
            <VisualScrubInput
              label={t("styleInspector.line")}
              value={snapshot.lineHeight}
              min={0.8}
              max={3}
              step={0.05}
              onChange={(value) => onChange({ lineHeight: String(value) })}
            />
          </div>
          <VisualSegmentedControl
            value={snapshot.fontWeight}
            onChange={(value) => onChange({ fontWeight: value })}
            options={[
              { label: t("styleInspector.regular"), value: "400" },
              { label: t("styleInspector.medium"), value: "500" },
              { label: t("styleInspector.semi"), value: "600" },
              { label: t("styleInspector.bold"), value: "700" },
            ]}
          />
          <VisualSegmentedControl
            value={snapshot.textAlign}
            onChange={(value) => onChange({ textAlign: value })}
            options={[
              { label: t("styleInspector.left"), value: "left" },
              { label: t("styleInspector.center"), value: "center" },
              { label: t("styleInspector.right"), value: "right" },
              { label: t("styleInspector.justify"), value: "justify" },
            ]}
          />
          <div className="flex justify-between px-1 text-muted-foreground">
            <IconAlignLeft className="size-3.5" />
            <IconAlignCenter className="size-3.5" />
            <IconAlignRight className="size-3.5" />
            <IconAlignJustified className="size-3.5" />
          </div>
        </VisualInspectorSection>
      )}

      <VisualInspectorSection
        title={
          <span className="inline-flex items-center gap-1.5">
            <IconDroplet className="size-3" />
            {t("styleInspector.fill")}
          </span>
        }
      >
        <VisualControlRow
          label={
            snapshot.isImage
              ? t("styleInspector.tint")
              : t("styleInspector.fill")
          }
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
            onChange={(value) => onChange({ backgroundColor: value })}
          />
        </VisualControlRow>
        <VisualScrubInput
          label={t("styleInspector.alpha")}
          value={snapshot.opacity}
          min={0}
          max={100}
          step={5}
          unit="%"
          onChange={(value) => onChange({ opacity: String(value / 100) })}
        />
      </VisualInspectorSection>

      <VisualInspectorSection
        title={
          <span className="inline-flex items-center gap-1.5">
            <IconBorderRadius className="size-3" />
            {t("styleInspector.stroke")}
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          <VisualScrubInput
            label={t("styleInspector.radius")}
            value={snapshot.borderRadius}
            min={0}
            max={96}
            step={1}
            unit="px"
            onChange={(value) => onChange({ borderRadius: `${value}px` })}
          />
          <VisualScrubInput
            label={t("styleInspector.line")}
            value={snapshot.borderWidth}
            min={0}
            max={16}
            step={1}
            unit="px"
            onChange={(value) => onChange({ borderWidth: `${value}px` })}
          />
        </div>
        <VisualControlRow label={t("styleInspector.strokeColor")}>
          <VisualColorPicker
            label={t("styleInspector.strokeColor")}
            value={snapshot.borderColor}
            documentColors={documentColors}
            onChange={(value) => onChange({ borderColor: value })}
          />
        </VisualControlRow>
      </VisualInspectorSection>

      {!snapshot.isImage && (
        <VisualInspectorSection
          title={
            <span className="inline-flex items-center gap-1.5">
              <IconBoxPadding className="size-3" />
              {t("styleInspector.spacing")}
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-2">
            <VisualScrubInput
              label={t("styleInspector.x")}
              value={snapshot.paddingX}
              min={0}
              max={120}
              step={2}
              unit="px"
              onChange={(value) =>
                onChange({
                  paddingLeft: `${value}px`,
                  paddingRight: `${value}px`,
                })
              }
            />
            <VisualScrubInput
              label={t("styleInspector.y")}
              value={snapshot.paddingY}
              min={0}
              max={120}
              step={2}
              unit="px"
              onChange={(value) =>
                onChange({
                  paddingTop: `${value}px`,
                  paddingBottom: `${value}px`,
                })
              }
            />
          </div>
        </VisualInspectorSection>
      )}
    </VisualInspectorPanel>
  );
}
