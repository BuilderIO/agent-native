import { checkboxCardsProps, COLORS } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";

import {
  CheckboxCards,
  CheckboxCardsItem,
  type CheckboxCardsProps,
} from "../../../src/ui/base-ui/checkbox-cards.js";
import { Field } from "../../../src/ui/base-ui/field.js";
import { propControls } from "../prop-controls.js";

const controls = propControls(checkboxCardsProps);

const CHANNELS = [
  { value: "email", name: "Email", detail: "A daily digest" },
  { value: "sms", name: "SMS", detail: "Mentions only" },
  { value: "push", name: "Push", detail: "Everything" },
] as const;

const threeColumns = {
  "--checkbox-cards-columns": "repeat(3, minmax(0, 1fr))",
} as CSSProperties;

function Channels(props: CheckboxCardsProps) {
  return (
    <CheckboxCards
      defaultValue={["email"]}
      aria-label="Channels"
      style={threeColumns}
      {...props}
    >
      {CHANNELS.map((channel) => (
        <CheckboxCardsItem key={channel.value} value={channel.value}>
          <span className="flex flex-col">
            <span className="font-medium">{channel.name}</span>
            <span className="text-fg-muted">{channel.detail}</span>
          </span>
        </CheckboxCardsItem>
      ))}
    </CheckboxCards>
  );
}

const meta = {
  title: "Components/Checkbox Cards",
  component: CheckboxCards,
  parameters: { layout: "padded" },
  args: { ...controls.args, disabled: false },
  argTypes: controls.argTypes,
  render: (args) => (
    <div className="max-w-[560px]">
      <Channels {...args} />
    </div>
  ),
} satisfies Meta<typeof CheckboxCards>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The cards with the group props from the controls. */
export const Playground: Story = {};

/** Sizes 1 to 3, each card's checkbox at the same size. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex max-w-[560px] flex-col gap-6">
      {checkboxCardsProps.size.values.map((size) => (
        <CheckboxCards
          key={size}
          {...args}
          size={size}
          defaultValue={["email"]}
          aria-label={`Channels, size ${size}`}
          style={threeColumns}
        >
          {CHANNELS.map((channel) => (
            <CheckboxCardsItem key={channel.value} value={channel.value}>
              {channel.name}
            </CheckboxCardsItem>
          ))}
        </CheckboxCards>
      ))}
    </div>
  ),
};

/** Each variant in every color, then in high contrast. */
export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-8">
      {[false, true].map((highContrast) =>
        checkboxCardsProps.variant.values.map((variant) => (
          <div
            key={`${variant}-${String(highContrast)}`}
            className="flex flex-col gap-2"
          >
            <span className="text-xs text-fg-muted">
              {variant}
              {highContrast ? ", high contrast" : ""}
            </span>
            <div className="grid grid-cols-3 gap-4">
              {COLORS.map((color) => (
                <Channels
                  key={color}
                  {...args}
                  variant={variant}
                  color={color}
                  highContrast={highContrast}
                  aria-label={`Channels, ${color}`}
                  style={{}}
                />
              ))}
            </div>
          </div>
        )),
      )}
    </div>
  ),
};

/** Columns from `--checkbox-cards-columns`: as many as fit, then one. */
export const Columns: Story = {
  render: (args) => (
    <div className="flex max-w-[560px] flex-col gap-6">
      <Channels {...args} style={{}} />
      <Channels
        {...args}
        style={{ "--checkbox-cards-columns": "1fr" } as CSSProperties}
      />
    </div>
  ),
};

/** A disabled card, an invalid group, and a disabled group. */
export const States: Story = {
  render: (args) => (
    <div className="flex max-w-[560px] flex-col gap-6">
      <CheckboxCards
        {...args}
        defaultValue={["email", "push"]}
        aria-label="Channels"
        style={threeColumns}
      >
        <CheckboxCardsItem value="email">Email</CheckboxCardsItem>
        <CheckboxCardsItem value="sms">SMS</CheckboxCardsItem>
        <CheckboxCardsItem value="push" disabled>
          Push
        </CheckboxCardsItem>
      </CheckboxCards>
      <Field invalid>
        <Channels {...args} defaultValue={[]} aria-label="Channels, invalid" />
      </Field>
      <Channels {...args} disabled aria-label="Channels, disabled" />
    </div>
  ),
};
