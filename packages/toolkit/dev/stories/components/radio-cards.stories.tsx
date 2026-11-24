import { COLORS, radioCardsProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useId, type CSSProperties } from "react";
import { expect } from "storybook/test";

import { Field } from "../../../src/ui/base-ui/field.js";
import {
  RadioCards,
  RadioCardsItem,
  type RadioCardsProps,
} from "../../../src/ui/base-ui/radio-cards.js";
import { propControls } from "../prop-controls.js";
import guide from "./radio-cards.docs.md?raw";

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
  const id = useId();
  return (
    <RadioCards
      defaultValue="pro"
      aria-label="Plan"
      style={threeColumns}
      {...props}
    >
      {PLANS.map((plan) => (
        <RadioCardsItem
          key={plan.value}
          value={plan.value}
          aria-labelledby={`${id}-${plan.value}-name`}
          aria-describedby={`${id}-${plan.value}-detail`}
        >
          <span className="flex flex-col">
            <span id={`${id}-${plan.value}-name`} className="font-medium">
              {plan.name}
            </span>
            <span id={`${id}-${plan.value}-detail`} className="text-fg-muted">
              {plan.detail}
            </span>
          </span>
        </RadioCardsItem>
      ))}
    </RadioCards>
  );
}

const meta = {
  title: "Components/Radio Cards",
  component: RadioCards,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
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
export const Playground: Story = {
  play: async ({ canvas, userEvent }) => {
    const pro = canvas.getByRole("radio", { name: "Pro" });
    await expect(pro).toHaveAccessibleDescription("$20 a month");
    await userEvent.click(pro);
    await userEvent.keyboard("{ArrowDown}");
    const team = canvas.getByRole("radio", { name: "Team" });
    await expect(team).toBeChecked();
    await expect(team).toHaveFocus();
    await expect(team).toHaveAccessibleDescription("$50 a seat");
  },
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

export const NarrowPanel: Story = {
  render: (args) => (
    <div style={{ inlineSize: 144 }}>
      <RadioCards {...args} aria-label="Templates">
        <RadioCardsItem value="design">
          <span>DesignSystemComponents</span>
        </RadioCardsItem>
        <RadioCardsItem value="assets">Assets</RadioCardsItem>
      </RadioCards>
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    const card = canvas.getByRole("radio", { name: "DesignSystemComponents" });
    const group = canvas.getByRole("radiogroup", { name: "Templates" });
    await expect(group.scrollWidth).toBeLessThanOrEqual(group.clientWidth);
    await expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
    card.focus();
    await userEvent.keyboard(" ");
    await expect(card).toBeChecked();
  },
};

export const ItemOverrides: Story = {
  render: () => (
    <RadioCards
      aria-label="Publishing"
      defaultValue="automatic"
      color="gray"
      variant="soft"
      highContrast
    >
      <RadioCardsItem value="automatic">Automatic</RadioCardsItem>
      <RadioCardsItem
        value="manual"
        variant="surface"
        highContrast={false}
        color="accent"
      >
        Manual approval
      </RadioCardsItem>
    </RadioCards>
  ),
  play: async ({ canvas, userEvent }) => {
    const automatic = canvas.getByRole("radio", { name: "Automatic" });
    const manual = canvas.getByRole("radio", { name: "Manual approval" });
    await expect(automatic).toHaveAttribute("data-color", "gray");
    await expect(automatic).toHaveAttribute("data-high-contrast");
    await expect(manual).toHaveAttribute("data-color", "accent");
    await expect(manual).toHaveAttribute("data-variant", "surface");
    await expect(manual).not.toHaveAttribute("data-high-contrast");
    automatic.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(manual).toBeChecked();
    await expect(automatic).not.toBeChecked();
  },
};
