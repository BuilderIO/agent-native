import {
  IconArrowsHorizontal,
  IconArrowsVertical,
  IconGridDots,
  IconLayoutColumns,
  IconLayoutRows,
  IconLink,
  IconLinkOff,
  IconSpacingHorizontal,
  IconTextWrap,
} from "@tabler/icons-react";
import * as React from "react";

import { isComposingKey } from "../is-composing-key.js";
import {
  AlignmentPicker,
  type AlignmentPickerProps,
  type AlignmentValue,
} from "./alignment-picker.js";
import { Checkbox } from "./checkbox.js";
import {
  GridSizePicker,
  type GridSizePickerProps,
  type GridSize,
} from "./grid-size-picker.js";
import { InputSlot } from "./input.js";
import { InspectorField, InspectorGrid } from "./inspector.js";
import {
  NumberField,
  NumberFieldScrubArea,
  type NumberFieldProps,
} from "./number-field.js";
import { observeFieldsetDisabled } from "./observe-fieldset-disabled.js";
import { SegmentedControl, SegmentedControlItem } from "./segmented-control.js";
import { activeElementInRoot } from "./surface-target.js";
import { Toggle } from "./toggle.js";

export type PropertyEdit<T> =
  | { phase: "preview" | "commit"; value: T }
  | { phase: "cancel" };

export interface PropertyNumberProps extends Pick<
  NumberFieldProps,
  | "id"
  | "disabled"
  | "readOnly"
  | "min"
  | "max"
  | "step"
  | "unit"
  | "format"
  | "locale"
  | "size"
  | "variant"
  | "className"
> {
  label: string;
  /** null represents a mixed or unspecified value. */
  value: number | null;
  placeholder?: string;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  /** Host-owned validation message. Pass null while valid to keep its live region ready. */
  error?: string | null;
  onEdit: (edit: PropertyEdit<number>) => void;
}

/** A controlled numeric property. Use the selection's identity as the React key
 * when changing the edit target. A scrub previews its changes and commits once.
 * Typing commits on blur or Enter. Escape discards the current gesture.
 * @import import { PropertyNumber } from "@agent-native/toolkit/ui/base-ui/layout-properties";
 */
export function PropertyNumber({
  label,
  value,
  placeholder,
  prefix,
  suffix,
  error,
  onEdit,
  ...props
}: PropertyNumberProps) {
  const fieldId = React.useId();
  const messageId = fieldId + "-error";
  const pending = React.useRef(false);
  const typing = React.useRef(false);
  const [revision, reset] = React.useReducer((n: number) => n + 1, 0);
  const input = React.useRef<HTMLInputElement>(null);
  const restoreSelection = React.useRef<{
    start: number;
    end: number;
    direction: HTMLInputElement["selectionDirection"];
  } | null>(null);
  const fieldsetObserver = React.useRef<MutationObserver | null>(null);
  const cleanup = React.useRef(onEdit);
  React.useLayoutEffect(() => {
    cleanup.current = onEdit;
  });
  React.useEffect(
    () => () => {
      fieldsetObserver.current?.disconnect();
      if (pending.current) cleanup.current({ phase: "cancel" });
    },
    [],
  );
  React.useLayoutEffect(() => {
    const selection = restoreSelection.current;
    restoreSelection.current = null;
    if (selection && input.current) {
      input.current.focus({ preventScroll: true });
      input.current.setSelectionRange(
        selection.start,
        selection.end,
        selection.direction ?? undefined,
      );
    }
  }, [revision]);
  function cancel(focus: boolean) {
    fieldsetObserver.current?.disconnect();
    if (pending.current || error) onEdit({ phase: "cancel" });
    pending.current = false;
    typing.current = false;
    const field = input.current;
    restoreSelection.current =
      focus && field
        ? {
            start: field.selectionStart ?? 0,
            end: field.selectionEnd ?? 0,
            direction: field.selectionDirection,
          }
        : null;
    reset();
  }
  const cancelCurrent = React.useRef(cancel);
  React.useLayoutEffect(() => {
    cancelCurrent.current = cancel;
    if (
      (props.disabled || props.readOnly) &&
      (typing.current || pending.current)
    ) {
      const field = input.current;
      cancel(
        !props.disabled &&
          field !== null &&
          activeElementInRoot(field) === field,
      );
    }
  });
  return (
    <InspectorField>
      <NumberField
        key={revision}
        {...props}
        id={props.id ?? fieldId}
        ref={input}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? messageId : undefined}
        value={value}
        placeholder={placeholder}
        onFocus={(event) => {
          const field = event.currentTarget;
          const win = field.ownerDocument.defaultView;
          if (!win || !field.closest("fieldset")) return;
          fieldsetObserver.current?.disconnect();
          const observer = new win.MutationObserver(() => {
            if (
              (typing.current || pending.current) &&
              field.matches(":disabled")
            )
              cancelCurrent.current(false);
          });
          fieldsetObserver.current = observer;
          observeFieldsetDisabled(field, observer);
        }}
        onInput={() => {
          typing.current = true;
        }}
        onValueChange={(next) => {
          if (next !== null) {
            pending.current = true;
            onEdit({ phase: "preview", value: next });
          }
        }}
        onValueCommitted={(next) => {
          if (input.current?.matches(":disabled, [readonly]")) return;
          typing.current = false;
          if (next === null) {
            cancel(false);
            return;
          }
          if (pending.current) {
            pending.current = false;
            onEdit({ phase: "commit", value: next });
          }
        }}
        onKeyDown={(event) => {
          if (event.defaultPrevented || isComposingKey(event)) return;
          if (
            event.key === "Escape" &&
            (typing.current || pending.current || error)
          ) {
            event.preventDefault();
            event.stopPropagation();
            cancel(true);
          } else if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        onBlur={() => {
          fieldsetObserver.current?.disconnect();
          queueMicrotask(() => {
            if (
              (pending.current || typing.current) &&
              input.current &&
              activeElementInRoot(input.current) !== input.current
            )
              cancel(false);
          });
        }}
      >
        {prefix != null && (
          <NumberFieldScrubArea
            pixelSensitivity={1}
            onScrubCancel={() =>
              cancel(
                input.current !== null &&
                  activeElementInRoot(input.current) === input.current,
              )
            }
          >
            {prefix}
          </NumberFieldScrubArea>
        )}
        {suffix != null && <InputSlot side="right">{suffix}</InputSlot>}
      </NumberField>
      {error !== undefined && (
        <span id={messageId} role="alert" className="type-label text-fg-danger">
          {error}
        </span>
      )}
    </InspectorField>
  );
}

export type LayoutAxis = "width" | "height";
export interface LayoutDimensionsValue {
  width: number;
  height: number;
  aspectRatio: number | null;
}
export type LayoutResize = { axis: LayoutAxis; value: number };
export interface LayoutSizeLimits {
  min?: number;
  max?: number;
}

function fitsAspectRatio(ratio: number, min: number, max: number) {
  return min === 0 || (ratio >= min / max && ratio <= max / min);
}

/** Whether a frame's dimensions define a usable width-to-height ratio. */
export function canLockAspectRatio(
  width: number,
  height: number,
  limits?: LayoutSizeLimits,
) {
  return (
    width > 0 && height > 0 && canResizeWithAspectRatio(width / height, limits)
  );
}

/** Whether an existing lock permits any size inside the current limits. */
export function canResizeWithAspectRatio(
  ratio: number,
  limits?: LayoutSizeLimits,
) {
  const min = limits?.min ?? 0;
  const max = Math.min(limits?.max ?? Infinity, Number.MAX_VALUE);
  return (
    ratio > 0 &&
    Number.isFinite(ratio) &&
    min >= 0 &&
    min <= max &&
    fitsAspectRatio(ratio, min, max)
  );
}

/** Prepare a dimension edit once, then apply it to each selected frame. */
export function createLayoutResize(
  edit: LayoutResize,
  limits: LayoutSizeLimits = {},
) {
  const min = limits.min ?? 0,
    max = limits.max ?? Infinity;
  if (
    !Number.isFinite(min) ||
    Number.isNaN(max) ||
    min < 0 ||
    min > max ||
    !Number.isFinite(edit.value)
  )
    throw new RangeError("Invalid layout dimension or limits.");
  const finiteMax = Math.min(max, Number.MAX_VALUE);
  const clamp = (size: number) => Math.max(min, Math.min(finiteMax, size));
  const editingWidth = edit.axis === "width";
  const value = clamp(edit.value);
  return <T extends LayoutDimensionsValue>(frame: T): T => {
    const ratio = frame.aspectRatio;
    if (ratio !== null && (!Number.isFinite(ratio) || ratio <= 0))
      throw new RangeError("Aspect ratio must be positive and finite.");
    let width = editingWidth ? value : frame.width;
    let height = editingWidth ? frame.height : value;
    if (ratio !== null) {
      if (!fitsAspectRatio(ratio, min, finiteMax))
        throw new RangeError(
          "The size limits cannot preserve this aspect ratio.",
        );
      if (editingWidth) {
        const projected = width / ratio;
        height = clamp(projected);
        if (height !== projected) width = clamp(height * ratio);
      } else {
        const projected = height * ratio;
        width = clamp(projected);
        if (width !== projected) height = clamp(width / ratio);
      }
    }
    return width === frame.width && height === frame.height
      ? frame
      : { ...frame, width, height };
  };
}

export function resizeLayout<T extends LayoutDimensionsValue>(
  frame: T,
  edit: LayoutResize,
  limits?: LayoutSizeLimits,
): T {
  return createLayoutResize(edit, limits)(frame);
}

const DimensionField = React.memo(function DimensionField({
  axis,
  onEdit,
  ...props
}: Omit<PropertyNumberProps, "onEdit"> & {
  axis: LayoutAxis;
  onEdit: (event: PropertyEdit<LayoutResize>) => void;
}) {
  return (
    <PropertyNumber
      {...props}
      onEdit={(event) =>
        onEdit(
          event.phase === "cancel"
            ? event
            : { phase: event.phase, value: { axis, value: event.value } },
        )
      }
    />
  );
});

/** Width and height can independently be mixed. Use lockDisabled to control lock availability and dimensionsReadOnly to keep incompatible selections inspectable. */
export function LayoutDimensions({
  width,
  height,
  locked,
  onLockChange,
  lockDisabled,
  dimensionsReadOnly,
  onEdit,
  limits,
  labels = {},
  prefixes = {},
  suffixes = {},
  locale,
  children,
}: {
  width: number | null;
  height: number | null;
  locked: boolean | "mixed";
  onLockChange: (locked: boolean) => void;
  lockDisabled?: boolean;
  dimensionsReadOnly?: boolean;
  onEdit: (edit: PropertyEdit<LayoutResize>) => void;
  limits?: LayoutSizeLimits;
  labels?: Partial<Record<LayoutAxis | "lock" | "mixed", string>>;
  prefixes?: Partial<Record<LayoutAxis, React.ReactNode>>;
  suffixes?: Partial<Record<LayoutAxis, React.ReactNode>>;
  locale?: NumberFieldProps["locale"];
  children?: React.ReactNode;
}) {
  return (
    <InspectorGrid>
      {(["width", "height"] as const).map((axis) => (
        <DimensionField
          key={axis}
          axis={axis}
          readOnly={dimensionsReadOnly}
          label={labels[axis] ?? (axis === "width" ? "Width" : "Height")}
          prefix={
            axis in prefixes ? prefixes[axis] : axis === "width" ? "W" : "H"
          }
          suffix={suffixes[axis]}
          locale={locale}
          value={axis === "width" ? width : height}
          placeholder={labels.mixed ?? "Mixed"}
          min={limits?.min ?? 0}
          max={limits?.max}
          onEdit={onEdit}
        />
      ))}
      {children ?? (
        <Toggle
          className="justify-self-center"
          color="gray"
          aria-label={labels.lock ?? "Lock aspect ratio"}
          title={labels.lock ?? "Lock aspect ratio"}
          disabled={
            lockDisabled ??
            (locked !== true &&
              !canLockAspectRatio(
                width ?? 1,
                height ?? 1,
                width !== null && height !== null ? limits : undefined,
              ))
          }
          pressed={locked === true}
          aria-pressed={locked}
          onPressedChange={onLockChange}
        >
          {locked === true ? <IconLink /> : <IconLinkOff />}
        </Toggle>
      )}
    </InspectorGrid>
  );
}

export interface AutoLayoutValue {
  mode: "row" | "column" | "grid";
  alignment: AlignmentValue;
  grid: GridSize;
  gap: number;
  paddingX: number;
  paddingY: number;
  wrap: boolean;
  clip: boolean;
}
const modes = [
  { value: "row", label: "Horizontal", Icon: IconLayoutColumns },
  { value: "column", label: "Vertical", Icon: IconLayoutRows },
  { value: "grid", label: "Grid", Icon: IconGridDots },
] as const;
type LayoutCopy =
  | "row"
  | "column"
  | "grid"
  | "flow"
  | "direction"
  | "align"
  | "matrix"
  | "tracks"
  | "gap"
  | "paddingX"
  | "paddingY"
  | "wrap"
  | "clip";

/** Controlled rows for an enabled automatic layout. Children of the selected document
 * and undo history stay with the host. Patches contain only the edited property.
 * @import import { AutoLayoutControls, LayoutDimensions } from "@agent-native/toolkit/ui/base-ui/layout-properties";
 */
export function AutoLayoutControls({
  value,
  onEdit,
  labels = {},
  spacingLimits,
  getCellLabel,
  gridLabels,
  locale,
}: {
  value: AutoLayoutValue;
  onEdit: (edit: PropertyEdit<Partial<AutoLayoutValue>>) => void;
  labels?: Partial<Record<LayoutCopy, string>>;
  spacingLimits?: LayoutSizeLimits;
  getCellLabel?: AlignmentPickerProps["getCellLabel"];
  gridLabels?: GridSizePickerProps["labels"];
  locale?: NumberFieldProps["locale"];
}) {
  const commit = (patch: Partial<AutoLayoutValue>) =>
    onEdit({ phase: "commit", value: patch });
  function spacing(
    key: "gap" | "paddingX" | "paddingY",
    label: string,
    icon: React.ReactNode,
  ) {
    return (
      <PropertyNumber
        label={labels[key] ?? label}
        value={value[key]}
        min={spacingLimits?.min ?? 0}
        max={spacingLimits?.max}
        prefix={icon}
        locale={locale}
        onEdit={(e) =>
          onEdit(
            e.phase === "cancel"
              ? e
              : { phase: e.phase, value: { [key]: e.value } },
          )
        }
      />
    );
  }
  return (
    <>
      <InspectorGrid className="inspector-layout-flow">
        <InspectorField className="inspector-layout-matrix">
          <span>
            {value.mode === "grid"
              ? (labels.tracks ?? "Grid size")
              : (labels.align ?? "Alignment")}
          </span>
          {value.mode === "grid" ? (
            <GridSizePicker
              className="justify-self-start"
              {...(gridLabels && { labels: gridLabels })}
              value={value.grid}
              onValueChange={(grid) => commit({ grid })}
            />
          ) : (
            <AlignmentPicker
              className="justify-self-start"
              aria-label={labels.matrix ?? "Frame alignment"}
              {...(getCellLabel && { getCellLabel })}
              direction={value.mode}
              value={value.alignment}
              onValueChange={(alignment) => commit({ alignment })}
            />
          )}
        </InspectorField>
        <InspectorField>
          <span>{labels.flow ?? "Flow"}</span>
          <SegmentedControl
            aria-label={labels.direction ?? "Layout direction"}
            value={value.mode}
            onValueChange={(v) => {
              const next = modes.find((m) => m.value === v);
              if (next) commit({ mode: next.value });
            }}
          >
            {modes.map(({ value, label, Icon }) => (
              <SegmentedControlItem
                key={value}
                value={value}
                aria-label={labels[value] ?? label}
                title={labels[value] ?? label}
              >
                <Icon aria-hidden />
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </InspectorField>
        {value.mode !== "grid" && (
          <Toggle
            className="justify-self-center"
            aria-label={labels.wrap ?? "Wrap"}
            title={labels.wrap ?? "Wrap"}
            pressed={value.wrap}
            onPressedChange={(wrap) => commit({ wrap })}
          >
            <IconTextWrap />
          </Toggle>
        )}
        {spacing("gap", "Gap", <IconSpacingHorizontal />)}
      </InspectorGrid>
      <InspectorGrid>
        {spacing("paddingX", "Horizontal padding", <IconArrowsHorizontal />)}
        {spacing("paddingY", "Vertical padding", <IconArrowsVertical />)}
      </InspectorGrid>
      <label className="flex items-center gap-2 text-xs">
        <Checkbox
          checked={value.clip}
          onCheckedChange={(clip) => commit({ clip })}
        />
        {labels.clip ?? "Clip content"}
      </label>
    </>
  );
}
