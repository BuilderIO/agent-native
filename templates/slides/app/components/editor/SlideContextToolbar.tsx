import { useT } from "@agent-native/core/client/i18n";
import {
  VisualColorPicker,
  VisualScrubInput,
  VisualSegmentedControl,
} from "@agent-native/toolkit/design-tweaks";
import type { DesignSystemData } from "@shared/api";
import {
  IconArrowAutofitHeight,
  IconBorderRadius,
  IconBorderStyle,
  IconGridDots,
  IconLetterCase,
} from "@tabler/icons-react";

import { cn } from "@/lib/utils";

import {
  backgroundCssValue,
  formatValue,
  tokenPalette,
  type SlideStylePatch,
  type SlideStyleSnapshot,
} from "./SlideStyleInspector";

const TOOLBAR_DIVIDER = "mx-1 h-4 w-px shrink-0 bg-border";
const SWATCH_CLASS = "shrink-0 rounded-sm";
const SCRUB_CLASS = "w-24 shrink-0";

/**
 * Horizontal counterpart to the style dock: the same snapshot and patch
 * callback, presented as a row above the canvas so the slide keeps full width.
 */
export function SlideContextToolbar({
  snapshot,
  background,
  designSystem,
  className,
  onChange,
  onBackgroundChange,
}: {
  snapshot: SlideStyleSnapshot | null;
  background: string | undefined;
  designSystem?: DesignSystemData;
  className?: string;
  onChange: (patch: SlideStylePatch) => void;
  onBackgroundChange: (background: string) => void;
}) {
  const t = useT();
  const documentColors = tokenPalette(designSystem, t).map(
    (option) => option.value,
  );
  const inlineEditSurfaceProps = {
    "data-slide-inline-edit-surface": "true",
  };
  const mixedTextStyles = snapshot?.mixedTextStyles ?? [];
  // Null means the slide uses a background this picker cannot represent (named
  // utility, gradient); surface that as Mixed rather than guessing a hex.
  const slideBackground = backgroundCssValue(background);

  return (
    <div
      className={cn(
        "slide-context-toolbar flex h-10 shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-border/70 bg-background/95 px-2 sm:px-3",
        className,
      )}
      data-slide-context-toolbar="true"
      role="toolbar"
      aria-label={t("styleInspector.title")}
    >
      {!snapshot ? (
        <VisualColorPicker
          label={t("styleInspector.slideBackground")}
          value={slideBackground ?? ""}
          mixed={slideBackground === null}
          mixedLabel={t("styleInspector.mixed")}
          documentColors={documentColors}
          variant="filled"
          className={SWATCH_CLASS}
          contentProps={inlineEditSurfaceProps}
          onChange={onBackgroundChange}
        />
      ) : snapshot.isText ? (
        <>
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
            className={SCRUB_CLASS}
            onChange={(fontSize) =>
              onChange({ fontSize: `${formatValue(fontSize)}px` })
            }
          />
          <VisualSegmentedControl
            value={
              mixedTextStyles.includes("fontWeight")
                ? null
                : snapshot.fontWeight
            }
            onChange={(fontWeight) => onChange({ fontWeight })}
            className="slides-inspector-segment shrink-0"
            options={[
              { label: t("styleInspector.regular"), value: "400" },
              { label: t("styleInspector.medium"), value: "500" },
              { label: t("styleInspector.semi"), value: "600" },
              { label: t("styleInspector.bold"), value: "700" },
            ]}
          />

          <div className={TOOLBAR_DIVIDER} />
          <VisualColorPicker
            label={t("styleInspector.textColor")}
            value={snapshot.color}
            documentColors={documentColors}
            mixed={mixedTextStyles.includes("color")}
            mixedLabel={t("styleInspector.mixed")}
            variant="filled"
            className={SWATCH_CLASS}
            contentProps={inlineEditSurfaceProps}
            onChange={(value) => onChange({ color: value })}
          />

          <div className={TOOLBAR_DIVIDER} />
          <VisualSegmentedControl
            value={snapshot.textAlign}
            onChange={(textAlign) => onChange({ textAlign })}
            className="slides-inspector-segment shrink-0"
            options={[
              { label: t("styleInspector.left"), value: "left" },
              { label: t("styleInspector.center"), value: "center" },
              { label: t("styleInspector.right"), value: "right" },
              { label: t("styleInspector.justify"), value: "justify" },
            ]}
          />
          <VisualScrubInput
            label={t("styleInspector.line")}
            icon={IconArrowAutofitHeight}
            prefix="icon"
            value={snapshot.lineHeight}
            min={0.8}
            max={3}
            step={0.05}
            className={SCRUB_CLASS}
            onChange={(lineHeight) =>
              onChange({ lineHeight: formatValue(lineHeight) })
            }
          />
        </>
      ) : (
        <>
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
            className={SWATCH_CLASS}
            contentProps={inlineEditSurfaceProps}
            onChange={(value) => onChange({ backgroundColor: value })}
          />
          <VisualScrubInput
            label={t("styleInspector.opacity")}
            icon={IconGridDots}
            prefix="icon"
            value={snapshot.opacity}
            min={0}
            max={100}
            step={5}
            unit="%"
            className={SCRUB_CLASS}
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
            className={SCRUB_CLASS}
            onChange={(radius) =>
              onChange({ borderRadius: `${formatValue(radius)}px` })
            }
          />

          <div className={TOOLBAR_DIVIDER} />
          <VisualScrubInput
            label={t("styleInspector.strokeWeight")}
            icon={IconBorderStyle}
            prefix="icon"
            value={snapshot.borderWidth}
            min={0}
            max={16}
            unit="px"
            className={SCRUB_CLASS}
            onChange={(width) =>
              onChange({ borderWidth: `${formatValue(width)}px` })
            }
          />
          <VisualColorPicker
            label={t("styleInspector.strokeColor")}
            value={snapshot.borderColor}
            documentColors={documentColors}
            variant="filled"
            className={SWATCH_CLASS}
            contentProps={inlineEditSurfaceProps}
            onChange={(value) => onChange({ borderColor: value })}
          />
        </>
      )}
    </div>
  );
}
