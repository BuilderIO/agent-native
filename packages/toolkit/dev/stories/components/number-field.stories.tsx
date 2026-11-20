import {
  COLORS,
  CONTROL_SIZES,
  numberFieldProps,
} from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconAngle } from "@tabler/icons-react";

import { Field, FieldLabel } from "../../../src/ui/base-ui/field.js";
import { InputSlot } from "../../../src/ui/base-ui/input.js";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldScrubArea,
} from "../../../src/ui/base-ui/number-field.js";
import { VisuallyHidden } from "../../../src/ui/base-ui/visually-hidden.js";
import { propControls } from "../prop-controls.js";

const controls = propControls(numberFieldProps);

const VARIANTS = numberFieldProps.variant.values;

const meta = {
  title: "Components/Number Field",
  component: NumberField,
  parameters: { layout: "padded" },
  args: {
    ...controls.args,
    "aria-label": "Quantity",
    defaultValue: 4,
    min: 0,
    max: 99,
    disabled: false,
  },
  argTypes: controls.argTypes,
  decorators: [
    (Story) => (
      <div className="w-60">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NumberField>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The field with the props from the controls and its steppers. */
export const Playground: Story = {
  render: (args) => (
    <NumberField {...args}>
      <NumberFieldDecrement />
      <NumberFieldIncrement />
    </NumberField>
  ),
};

/** Sizes 1 to 4: the 16, 20, 24 and 32px control heights. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      {CONTROL_SIZES.map((size) => (
        <NumberField key={size} {...args} aria-label={undefined} size={size}>
          <NumberFieldScrubArea>Size {size}</NumberFieldScrubArea>
          <NumberFieldDecrement />
          <NumberFieldIncrement />
        </NumberField>
      ))}
    </div>
  ),
};

/**
 * Each variant in every color. Surface keeps neutral edges and gray
 * steppers in every color; soft tints both.
 */
export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      {COLORS.map((color) => (
        <div key={color} className="flex items-center gap-3">
          {VARIANTS.map((variant) => (
            <NumberField
              key={variant}
              {...args}
              variant={variant}
              color={color}
              aria-label={`${variant} ${color}`}
            >
              <NumberFieldDecrement />
              <NumberFieldIncrement />
            </NumberField>
          ))}
          <span className="w-16 shrink-0 text-xs text-fg-muted">{color}</span>
        </div>
      ))}
    </div>
  ),
  decorators: [
    (Story) => (
      <div className="w-[480px]">
        <Story />
      </div>
    ),
  ],
};

/**
 * Empty, filled, at its minimum (Decrease disabled), invalid, read only
 * and disabled, in each variant.
 */
export const States: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      {VARIANTS.map((variant) => (
        <div key={variant} className="flex flex-col gap-3">
          {[
            { label: "empty", props: { defaultValue: undefined } },
            { label: "filled", props: { defaultValue: 12 } },
            { label: "at minimum", props: { defaultValue: 0 } },
            {
              label: "invalid",
              props: { defaultValue: 120, "aria-invalid": true },
            },
            { label: "read only", props: { defaultValue: 12, readOnly: true } },
            { label: "disabled", props: { defaultValue: 12, disabled: true } },
          ].map(({ label, props }) => (
            <NumberField
              key={label}
              {...args}
              {...props}
              variant={variant}
              aria-label={undefined}
            >
              <NumberFieldScrubArea>{`${variant} ${label}`}</NumberFieldScrubArea>
              <NumberFieldDecrement />
              <NumberFieldIncrement />
            </NumberField>
          ))}
        </div>
      ))}
    </div>
  ),
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
};

/**
 * An inspector's fields: each label is a scrub area, so dragging X, Y, W
 * or H sideways changes the value a step per two pixels, with Shift for
 * ten. Arrow keys step the focused field the same way.
 */
export const WithScrubArea: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-2">
      {[
        { label: "X", value: 120 },
        { label: "Y", value: 48 },
        { label: "W", value: 320, min: 0 },
        { label: "H", value: 200, min: 0 },
      ].map(({ label, value, min }) => (
        <NumberField
          key={label}
          size="2"
          variant="soft"
          color="gray"
          defaultValue={value}
          {...(min === undefined ? {} : { min })}
        >
          <NumberFieldScrubArea>{label}</NumberFieldScrubArea>
        </NumberField>
      ))}
      <NumberField
        size="2"
        variant="soft"
        color="gray"
        defaultValue={0}
        format={{ maximumFractionDigits: 1 }}
      >
        <NumberFieldScrubArea>
          <IconAngle aria-hidden />
          <VisuallyHidden>Rotation</VisuallyHidden>
        </NumberFieldScrubArea>
        <InputSlot side="right">°</InputSlot>
      </NumberField>
      <NumberField
        size="2"
        variant="soft"
        color="gray"
        defaultValue={1}
        min={0}
        max={1}
        step={0.01}
        largeStep={0.1}
        format={{ style: "percent" }}
      >
        <NumberFieldScrubArea>Opacity</NumberFieldScrubArea>
      </NumberField>
    </div>
  ),
};

/** Intl number formats: currency, a unit, and grouped thousands. */
export const Formats: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel>Price</FieldLabel>
        <NumberField
          defaultValue={1234.5}
          step={0.5}
          format={{ style: "currency", currency: "USD" }}
        >
          <NumberFieldDecrement />
          <NumberFieldIncrement />
        </NumberField>
      </Field>
      <Field>
        <FieldLabel>Duration</FieldLabel>
        <NumberField
          defaultValue={90}
          min={0}
          format={{ style: "unit", unit: "minute", unitDisplay: "long" }}
        />
      </Field>
      <Field>
        <FieldLabel>Rows</FieldLabel>
        <NumberField defaultValue={1250000} step={1000} />
      </Field>
    </div>
  ),
};
