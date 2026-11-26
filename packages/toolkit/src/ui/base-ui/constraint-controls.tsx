import { Button as BaseButton } from "@base-ui/react/button";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../utils.js";
import { IconButton } from "./button.js";
import {
  Popover,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "./popover.js";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "./select.js";

const horizontal = ["left", "right", "left-right", "center", "scale"] as const;
const vertical = ["top", "bottom", "top-bottom", "center", "scale"] as const;
type Horizontal = (typeof horizontal)[number];
type Vertical = (typeof vertical)[number];
type Edge = "left" | "right" | "top" | "bottom";

export interface LayerConstraints {
  horizontal: Horizontal;
  vertical: Vertical;
}
export interface ConstraintValue {
  horizontal: Horizontal | "mixed";
  vertical: Vertical | "mixed";
}
export type ConstraintEdit =
  | { horizontal: Horizontal }
  | { vertical: Vertical };
const defaultLabels = {
  horizontal: "Horizontal constraint",
  vertical: "Vertical constraint",
  title: "Constraints",
  left: "Left",
  right: "Right",
  top: "Top",
  bottom: "Bottom",
  "left-right": "Left and right",
  "top-bottom": "Top and bottom",
  center: "Center",
  scale: "Scale",
  mixed: "Mixed",
};
type Labels = typeof defaultLabels;
const edges = ["top", "left", "right", "bottom"] as const;

function pinMode(value: ConstraintValue, edge: Edge) {
  const mode =
    edge === "left" || edge === "right" ? value.horizontal : value.vertical;
  if (mode === "left-right" || mode === "top-bottom" || mode === edge)
    return "pinned";
  return mode === "scale" || mode === "mixed" ? mode : "off";
}

function changePin(value: ConstraintValue, edge: Edge): ConstraintEdit {
  if (edge === "left" || edge === "right") {
    const other = edge === "left" ? "right" : "left";
    return {
      horizontal:
        value.horizontal === "left-right"
          ? other
          : value.horizontal === other
            ? "left-right"
            : edge,
    };
  }
  const other = edge === "top" ? "bottom" : "top";
  return {
    vertical:
      value.vertical === "top-bottom"
        ? other
        : value.vertical === other
          ? "top-bottom"
          : edge,
  };
}

/** A decorative summary for a named trigger or a read-only row.
 * @import import { ConstraintPreview } from "@agent-native/toolkit/ui/base-ui/constraint-controls";
 */
export function ConstraintPreview({
  value,
  className,
  ...props
}: { value: ConstraintValue } & ComponentPropsWithoutRef<"span">) {
  return (
    <span
      {...props}
      className={cn("constraint-preview", className)}
      aria-hidden="true"
      data-horizontal={value.horizontal}
      data-vertical={value.vertical}
    >
      <span className="constraint-frame" />
      {edges.map((edge) => (
        <span
          key={edge}
          className="constraint-mark"
          data-edge={edge}
          data-mode={pinMode(value, edge)}
        />
      ))}
    </span>
  );
}

function AxisSelect<Mode extends Horizontal | Vertical>({
  options,
  value,
  name,
  labels,
  disabled,
  onChange,
}: {
  options: readonly Mode[];
  value: Mode | "mixed";
  name: string;
  labels: Labels;
  disabled?: boolean;
  onChange: (mode: Mode) => void;
}) {
  const items = options.map((mode) => ({ value: mode, label: labels[mode] }));
  return (
    <Select<Mode>
      aria-label={name}
      items={items}
      value={value === "mixed" ? null : value}
      disabled={disabled}
      size="sm"
      onValueChange={(mode) => {
        if (mode !== null) onChange(mode);
      }}
    >
      <SelectTrigger variant="soft">
        <SelectValue placeholder={labels.mixed} />
      </SelectTrigger>
      <SelectPopup>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export interface ConstraintControlsProps extends Omit<
  ComponentPropsWithoutRef<"div">,
  "onChange"
> {
  value: ConstraintValue;
  onChange: (change: ConstraintEdit) => void;
  disabled?: boolean;
  labels?: Partial<Labels>;
}

/** Edits one physical axis at a time, including for mixed selections.
 * @import import { ConstraintControls } from "@agent-native/toolkit/ui/base-ui/constraint-controls";
 */
export function ConstraintControls({
  value,
  onChange,
  disabled = false,
  labels,
  className,
  ...props
}: ConstraintControlsProps) {
  const copy = { ...defaultLabels, ...labels };
  return (
    <div
      role="group"
      aria-label={copy.title}
      {...props}
      className={cn("constraint-controls", className)}
    >
      <div className="constraint-axes">
        <AxisSelect
          options={horizontal}
          value={value.horizontal}
          name={copy.horizontal}
          labels={copy}
          disabled={disabled}
          onChange={(horizontal) => onChange({ horizontal })}
        />
        <AxisSelect
          options={vertical}
          value={value.vertical}
          name={copy.vertical}
          labels={copy}
          disabled={disabled}
          onChange={(vertical) => onChange({ vertical })}
        />
      </div>
      <div className="constraint-pins">
        <ConstraintPreview value={value} />
        {edges.map((edge) => {
          const mode = pinMode(value, edge);
          return (
            <BaseButton
              key={edge}
              className="constraint-pin"
              data-edge={edge}
              aria-label={copy[edge]}
              aria-pressed={mode === "mixed" ? "mixed" : mode === "pinned"}
              disabled={disabled}
              onClick={() => {
                const edit = changePin(value, edge);
                if (
                  "horizontal" in edit
                    ? edit.horizontal !== value.horizontal
                    : edit.vertical !== value.vertical
                )
                  onChange(edit);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Opens constraint controls from a named diagram button.
 * @import import { ConstraintPicker } from "@agent-native/toolkit/ui/base-ui/constraint-controls";
 */
export function ConstraintPicker(
  props: Pick<
    ConstraintControlsProps,
    "value" | "onChange" | "disabled" | "labels"
  >,
) {
  const copy = { ...defaultLabels, ...props.labels };
  return (
    <Popover>
      <PopoverTrigger
        render={<IconButton variant="ghost" color="gray" />}
        disabled={props.disabled}
        aria-label={copy.title}
        aria-description={`${copy.horizontal}: ${copy[props.value.horizontal]}. ${copy.vertical}: ${copy[props.value.vertical]}.`}
      >
        <ConstraintPreview value={props.value} />
      </PopoverTrigger>
      <PopoverPopup align="end">
        <PopoverTitle>{copy.title}</PopoverTitle>
        <ConstraintControls {...props} />
      </PopoverPopup>
    </Popover>
  );
}
