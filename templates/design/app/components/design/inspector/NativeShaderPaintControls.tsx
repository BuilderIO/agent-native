import { useT } from "@agent-native/core/client/i18n";
import type { EffectPaint } from "@shared/native-effects";
import { useState } from "react";

import { FillFieldFace, FillFieldSwatch } from "./color-picker-fill-field";
import type { RenderNestedColorPicker } from "./color-picker-nested";
import { swatchStyle } from "./color-picker-swatch";
import { readFillField } from "./fill-field-reading";
import {
  nativeEffectPaintFromCss,
  nativeEffectPaintToCss,
} from "./native-shader-paint";
import { useNativeShaderPropertyDraft } from "./native-shader-property-draft";

export function NativeShaderPaintControls({
  label,
  value,
  maxStops,
  disabled,
  onCommit,
  onPreview,
  renderColorPicker,
}: {
  label: string;
  value: EffectPaint;
  maxStops: number;
  disabled: boolean;
  onCommit: (value: EffectPaint) => Promise<boolean>;
  onPreview?: (value: EffectPaint) => void;
  renderColorPicker?: RenderNestedColorPicker;
}) {
  const t = useT();
  const { draft, preview, commit, cancel } = useNativeShaderPropertyDraft(
    value,
    onCommit,
    onPreview,
  );
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  const css = nativeEffectPaintToCss(draft);
  return (
    <>
      <button
        type="button"
        aria-label={label}
        disabled={disabled || !renderColorPicker}
        onClick={(event) => setPickerAnchor(event.currentTarget)}
        className="flex h-7 w-44 min-w-0 items-center gap-1.5 rounded-md bg-[var(--design-editor-control-bg)] px-1.5 text-left !text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      >
        <FillFieldFace
          reading={readFillField({
            paint: draft.kind === "solid" ? "solid" : "gradient",
            value: css,
            paintName:
              draft.kind === "solid"
                ? undefined
                : t(`editPanel.colorPicker.${draft.kind}`),
          })}
          swatch={<FillFieldSwatch style={swatchStyle(css)} />}
          opacity={Math.round(
            (draft.kind === "solid"
              ? draft.color.alpha
              : (draft.opacity ?? 1)) * 100,
          )}
          mixedLabel=""
        />
      </button>
      {pickerAnchor
        ? renderColorPicker?.({
            anchor: pickerAnchor,
            css,
            supportedPaintTypes: [
              "solid",
              "linear",
              "radial",
              "angular",
              "diamond",
            ],
            maxGradientStops: maxStops,
            showReverseStops: false,
            disabled,
            onChange: (nextCss) => {
              const next = nativeEffectPaintFromCss(nextCss, draft, maxStops);
              preview(next);
            },
            onCommit: (nextCss) =>
              commit(nativeEffectPaintFromCss(nextCss, draft, maxStops)),
            onClose: () => {
              cancel();
              setPickerAnchor(null);
            },
          })
        : null}
    </>
  );
}
