import { COLORS, radioCardsProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";

import { Field } from "../../../src/ui/base-ui/field.js";
import {
  RadioCards,
  RadioCardsItem,
  type RadioCardsProps,
} from "../../../src/ui/base-ui/radio-cards.js";
import { propControls } from "../prop-controls.js";

const controls = propControls(radioCardsProps);

const PLANS = [
  { value: "free", name: "Free", detail: "1 project" },
  { value: "pro", name: "Pro", detail: "$20 a month" },
  { value: "team", name: "Team", detail: "$50 a seat" },
] as const;

const threeColumns = {
  "--radio-cards-columns": "repeat(3, minmax(0, 1fr))",
} as CSSProperties;

function Plans(props: RadioCardsProps) {
  return (
    <RadioCards
      defaultValue="pro"
      aria-label="Plan"
      style={threeColumns}
      {...props}
    >
      {PLANS.map((plan) => (
        <RadioCardsItem key={plan.value} value={plan.value}>
          <span className="flex flex-col">
            <span className="font-medium">{plan.name}</span>
            <span className="text-fg-muted">{plan.detail}</span>
          </span>
        </RadioCardsItem>
      ))}
    </RadioCards>
  );
}

const meta = {
  title: "Components/Radio Cards",
  component: RadioCards,
  parameters: { layout: "padded" },
  args: { ...controls.args, disabled: false },
  argTypes: controls.argTypes,
  render: (args) => (
    <div className="max-w-[480px]">
      <Plans {...args} />
    </div>
  ),
} satisfies Meta<typeof RadioCards>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The cards with the group props from the controls. */
export const Playground: Story = {};

/** Sizes 1 to 3: cards 32, 40 and 52px tall for one line of text. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex max-w-[480px] flex-col gap-6">
      {radioCardsProps.size.values.map((size) => (
        <RadioCards
          key={size}
          {...args}
          size={size}
          defaultValue="pro"
          aria-label={`Plan, size ${size}`}
          style={threeColumns}
        >
          {PLANS.map((plan) => (
            <RadioCardsItem key={plan.value} value={plan.value}>
              {plan.name}
            </RadioCardsItem>
          ))}
        </RadioCards>
      ))}
    </div>
  ),
};

/** Each variant in every color, then in high contrast. */
export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-8">
      {[false, true].map((highContrast) =>
        radioCardsProps.variant.values.map((variant) => (
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
                <Plans
                  key={color}
                  {...args}
                  variant={variant}
                  color={color}
                  highContrast={highContrast}
                  aria-label={`Plan, ${color}`}
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

/** Columns from `--radio-cards-columns`: as many as fit, then two. */
export const Columns: Story = {
  render: (args) => (
    <div className="flex max-w-[480px] flex-col gap-6">
      <Plans {...args} style={{}} />
      <Plans
        {...args}
        style={{ "--radio-cards-columns": "1fr 1fr" } as CSSProperties}
      />
    </div>
  ),
};

/** A disabled card, an invalid group, and a disabled group. */
export const States: Story = {
  render: (args) => (
    <div className="flex max-w-[480px] flex-col gap-6">
      <RadioCards
        {...args}
        defaultValue="free"
        aria-label="Plan"
        style={threeColumns}
      >
        <RadioCardsItem value="free">Free</RadioCardsItem>
        <RadioCardsItem value="pro">Pro</RadioCardsItem>
        <RadioCardsItem value="team" disabled>
          Team
        </RadioCardsItem>
      </RadioCards>
      <Field invalid>
        <Plans {...args} defaultValue={null} aria-label="Plan, invalid" />
      </Field>
      <Plans {...args} disabled aria-label="Plan, disabled" />
    </div>
  ),
};
