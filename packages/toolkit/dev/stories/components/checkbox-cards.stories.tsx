import { checkboxCardsProps, COLORS } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconCheck } from "@tabler/icons-react";
import { useId, type CSSProperties } from "react";
import { expect } from "storybook/test";

import {
  CheckboxCards,
  CheckboxCardsItem,
  type CheckboxCardsProps,
} from "../../../src/ui/base-ui/checkbox-cards.js";
import { CheckboxIndicator } from "../../../src/ui/base-ui/checkbox.js";
import { Field } from "../../../src/ui/base-ui/field.js";
import { propControls } from "../prop-controls.js";
import guide from "./checkbox-cards.docs.md?raw";

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
  const id = useId();
  return (
    <CheckboxCards
      defaultValue={["email"]}
      aria-label="Channels"
      style={threeColumns}
      {...props}
    >
      {CHANNELS.map((channel) => (
        <CheckboxCardsItem
          key={channel.value}
          value={channel.value}
          aria-labelledby={`${id}-${channel.value}-name`}
          aria-describedby={`${id}-${channel.value}-detail`}
        >
          <span className="flex flex-col">
            <span id={`${id}-${channel.value}-name`} className="font-medium">
              {channel.name}
            </span>
            <span
              id={`${id}-${channel.value}-detail`}
              className="text-fg-muted"
            >
              {channel.detail}
            </span>
          </span>
        </CheckboxCardsItem>
      ))}
    </CheckboxCards>
  );
}

const meta = {
  title: "Components/Checkbox Cards",
  component: CheckboxCards,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
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

export const KeyboardSelection: Story = {
  play: async ({ canvas, userEvent }) => {
    const email = canvas.getByRole("checkbox", { name: "Email" });
    const sms = canvas.getByRole("checkbox", { name: "SMS" });
    await expect(email).toBeChecked();
    await expect(sms).not.toBeChecked();
    await expect(sms).toHaveAccessibleDescription("Mentions only");
    sms.focus();
    await userEvent.keyboard(" ");
    await expect(sms).toBeChecked();
    await expect(email).toBeChecked();
    await userEvent.keyboard(" ");
    await expect(sms).not.toBeChecked();
    await expect(sms).toHaveFocus();
  },
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

export const NarrowPanel: Story = {
  render: (args) => (
    <div style={{ inlineSize: 144 }}>
      <CheckboxCards {...args} aria-label="Templates">
        <CheckboxCardsItem value="design">
          <span>DesignSystemComponents</span>
        </CheckboxCardsItem>
        <CheckboxCardsItem value="assets">Assets</CheckboxCardsItem>
      </CheckboxCards>
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    const card = canvas.getByRole("checkbox", {
      name: "DesignSystemComponents",
    });
    const group = canvas.getByRole("group", { name: "Templates" });
    await expect(group.scrollWidth).toBeLessThanOrEqual(group.clientWidth);
    await expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
    card.focus();
    await userEvent.keyboard(" ");
    await expect(card).toBeChecked();
  },
};

export const ItemOverrides: Story = {
  render: () => (
    <CheckboxCards
      aria-label="Notifications"
      variant="soft"
      color="gray"
      highContrast
      defaultValue={["failures"]}
    >
      <CheckboxCardsItem
        value="updates"
        indicator={
          <CheckboxIndicator aria-hidden>
            <IconCheck />
          </CheckboxIndicator>
        }
      >
        Project updates
      </CheckboxCardsItem>
      <CheckboxCardsItem
        value="failures"
        color="danger"
        variant="surface"
        highContrast={false}
      >
        Deployment failures
      </CheckboxCardsItem>
    </CheckboxCards>
  ),
  play: async ({ canvas, userEvent }) => {
    const inherited = canvas.getByRole("checkbox", { name: "Project updates" });
    const override = canvas.getByRole("checkbox", {
      name: "Deployment failures",
    });
    await expect(inherited).toHaveAttribute("data-color", "gray");
    await expect(inherited).toHaveAttribute("data-high-contrast");
    await expect(inherited).toHaveAttribute("data-variant", "soft");
    await expect(override).toHaveAttribute("data-color", "danger");
    await expect(override).toHaveAttribute("data-variant", "surface");
    await expect(override).not.toHaveAttribute("data-high-contrast");
    await expect(
      override.querySelector(".checkbox-cards-checkbox"),
    ).toHaveAttribute("data-color", "danger");
    await userEvent.click(inherited);
    await expect(inherited).toBeChecked();
    const custom = inherited.querySelector("svg");
    const standard = override.querySelector("svg");
    if (!custom || !standard) throw new Error("Expected both selection marks");
    const glyph = custom.getBoundingClientRect();
    const reference = standard.getBoundingClientRect();
    await expect(glyph.width).toBe(reference.width);
    await expect(glyph.height).toBe(reference.height);
    const cardBounds = inherited.getBoundingClientRect();
    const referenceBounds = override.getBoundingClientRect();
    await expect(glyph.x - cardBounds.x).toBeCloseTo(
      reference.x - referenceBounds.x,
      0,
    );
    await expect(glyph.y - cardBounds.y).toBeCloseTo(
      reference.y - referenceBounds.y,
      0,
    );
    await expect(override).toBeChecked();
  },
};
