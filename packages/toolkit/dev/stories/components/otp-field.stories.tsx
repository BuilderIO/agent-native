import { COLORS, otpFieldProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "../../../src/ui/base-ui/field.js";
import {
  OTPField,
  OTPFieldInput,
  OTPFieldSeparator,
} from "../../../src/ui/base-ui/otp-field.js";
import { propControls } from "../prop-controls.js";
import guide from "./otp-field.docs.md?raw";

const controls = propControls(otpFieldProps);

const VARIANTS = otpFieldProps.variant.values;

const meta = {
  title: "Components/OTP Field",
  component: OTPField,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: { ...controls.args, length: 6, disabled: false },
  argTypes: controls.argTypes,
} satisfies Meta<typeof OTPField>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The field with the props from the controls. Typing moves to the next
 * box, Backspace and the arrow keys move back, and pasting a code fills
 * every box.
 */
export const Playground: Story = {
  render: (args) => (
    <Field>
      <FieldLabel>Verification code</FieldLabel>
      <OTPField {...args} />
      <FieldDescription>Enter the 6-digit code we sent you.</FieldDescription>
    </Field>
  ),
};

/** Each variant in every color. Surface keeps neutral edges in every color. */
export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-3">
      {COLORS.map((color) => (
        <div key={color} className="flex items-center gap-6">
          {VARIANTS.map((variant) => (
            <Field key={variant}>
              <FieldLabel className="visually-hidden">
                {variant} {color}
              </FieldLabel>
              <OTPField
                {...args}
                variant={variant}
                color={color}
                length={4}
                defaultValue="42"
              />
            </Field>
          ))}
          <span className="w-16 shrink-0 text-xs text-fg-muted">{color}</span>
        </div>
      ))}
    </div>
  ),
};

/**
 * Empty, partly filled, complete, invalid and disabled, in each variant,
 * and a six-character code grouped in threes.
 */
export const States: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4">
      {VARIANTS.map((variant) => (
        <div key={variant} className="flex flex-col gap-4">
          <Field>
            <FieldLabel>{variant} empty</FieldLabel>
            <OTPField {...args} variant={variant} />
          </Field>
          <Field>
            <FieldLabel>{variant} partly filled</FieldLabel>
            <OTPField {...args} variant={variant} defaultValue="381" />
          </Field>
          <Field>
            <FieldLabel>{variant} complete</FieldLabel>
            <OTPField {...args} variant={variant} defaultValue="381204" />
          </Field>
          <Field invalid>
            <FieldLabel>{variant} invalid</FieldLabel>
            <OTPField {...args} variant={variant} defaultValue="381204" />
            <FieldError match>That code has expired.</FieldError>
          </Field>
          <Field disabled>
            <FieldLabel>{variant} disabled</FieldLabel>
            <OTPField {...args} variant={variant} defaultValue="381" disabled />
          </Field>
        </div>
      ))}
      <Field>
        <FieldLabel>Grouped</FieldLabel>
        <OTPField {...args} length={6}>
          <OTPFieldInput />
          <OTPFieldInput aria-label="Character 2 of 6" />
          <OTPFieldInput aria-label="Character 3 of 6" />
          <OTPFieldSeparator />
          <OTPFieldInput aria-label="Character 4 of 6" />
          <OTPFieldInput aria-label="Character 5 of 6" />
          <OTPFieldInput aria-label="Character 6 of 6" />
        </OTPField>
      </Field>
    </div>
  ),
};
