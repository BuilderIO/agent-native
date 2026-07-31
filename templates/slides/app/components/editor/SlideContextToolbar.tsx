import { useT } from "@agent-native/core/client/i18n";
import {
  VisualColorPicker,
  VisualScrubInput,
  VisualSegmentedControl,
} from "@agent-native/toolkit/design-tweaks";
import type { DesignSystemData } from "@shared/api";
import { IconArrowAutofitHeight, IconLetterCase } from "@tabler/icons-react";

import { cn } from "@/lib/utils";

import {
  formatValue,
  tokenPalette,
  type SlideStylePatch,
  type SlideStyleSnapshot,
} from "./SlideStyleInspector";

const TOOLBAR_DIVIDER = "mx-1 h-4 w-px shrink-0 bg-border";

/**
 * Horizontal counterpart to the style dock: the same snapshot and patch
 * callback, presented as a row above the canvas so the slide keeps full width.
 */
export function SlideContextToolbar({
  snapshot,
  designSystem,
  className,
  onChange,
}: {
  snapshot: SlideStyleSnapshot | null;
  designSystem?: DesignSystemData;
  className?: string;
  onChange: (patch: SlideStylePatch) => void;
}) {
  const t = useT();
  const documentColors = tokenPalette(designSystem, t).map(
    (option) => option.value,
  );
  const inlineEditSurfaceProps = {
    "data-slide-inline-edit-surface": "true",
  };
  const mixedTextStyles = snapshot?.mixedTextStyles ?? [];
  const targetLabel = snapshot
    ? snapshot.textPreview || snapshot.label || snapshot.tagName.toUpperCase()
    : t("styleInspector.slide");

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
      <span className="max-w-[9rem] shrink-0 truncate text-xs text-muted-foreground">
        {targetLabel}
      </span>

      {snapshot?.isText ? (
        <>
          <div className={TOOLBAR_DIVIDER} />
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
            className="w-24 shrink-0"
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
            className="shrink-0 rounded-sm"
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
            className="w-24 shrink-0"
            onChange={(lineHeight) =>
              onChange({ lineHeight: formatValue(lineHeight) })
            }
          />
        </>
      ) : null}
    </div>
  );
}
