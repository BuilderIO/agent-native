import { calloutProps, COLORS } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
  IconTrash,
} from "@tabler/icons-react";

import { Button } from "../../../src/ui/base-ui/button.js";
import {
  Callout,
  CalloutActions,
  CalloutIcon,
  CalloutText,
} from "../../../src/ui/base-ui/callout.js";
import { propControls } from "../prop-controls.js";
import guide from "./callout.docs.md?raw";

const controls = propControls(calloutProps);

const meta = {
  title: "Components/Callout",
  component: Callout,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: {
    ...controls.args,
    children: (
      <>
        <CalloutIcon>
          <IconInfoCircle />
        </CalloutIcon>
        <CalloutText>Usage updates every hour.</CalloutText>
      </>
    ),
  },
  argTypes: controls.argTypes,
  decorators: [
    (Story) => (
      <div className="w-140">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Callout>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The callout with the props from the controls. */
export const Playground: Story = {};

/** Every variant in every color, then in high contrast. */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      {[false, true].map((highContrast) =>
        calloutProps.variant.values.map((variant) => (
          <div
            key={`${variant}-${String(highContrast)}`}
            className="flex flex-col gap-2"
          >
            <span className="text-xs text-fg-muted">
              {variant}
              {highContrast ? ", high contrast" : ""}
            </span>
            {COLORS.map((color) => (
              <Callout
                key={color}
                variant={variant}
                color={color}
                highContrast={highContrast}
              >
                <CalloutIcon>
                  <IconInfoCircle />
                </CalloutIcon>
                <CalloutText>{color}</CalloutText>
              </Callout>
            ))}
          </div>
        )),
      )}
    </div>
  ),
};

/**
 * The messages settings shows: information, success, a warning that
 * carries its Retry action, and danger only for something destroyed. Text
 * stacks when there is more than one line of it.
 */
export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Callout color="info">
        <CalloutIcon>
          <IconInfoCircle />
        </CalloutIcon>
        <CalloutText>A new version is available.</CalloutText>
      </Callout>
      <Callout color="success">
        <CalloutIcon>
          <IconCircleCheck />
        </CalloutIcon>
        <CalloutText>Your workspace is connected.</CalloutText>
      </Callout>
      <Callout variant="surface" color="warning">
        <CalloutIcon>
          <IconAlertTriangle />
        </CalloutIcon>
        <CalloutText>Usage couldn't load.</CalloutText>
        <CalloutActions>
          <Button variant="surface" color="gray" size="md">
            Retry
          </Button>
        </CalloutActions>
      </Callout>
      <Callout color="danger">
        <CalloutIcon>
          <IconTrash />
        </CalloutIcon>
        <CalloutText>This workspace will be deleted in 3 days.</CalloutText>
        <CalloutText>Export anything you want to keep before then.</CalloutText>
      </Callout>
    </div>
  ),
};
