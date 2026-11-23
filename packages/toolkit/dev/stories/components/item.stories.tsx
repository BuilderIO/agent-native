import { itemGroupProps, itemProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  IconBell,
  IconChevronRight,
  IconKey,
  IconMail,
} from "@tabler/icons-react";

import { Avatar, AvatarFallback } from "../../../src/ui/base-ui/avatar.js";
import { Badge } from "../../../src/ui/base-ui/badge.js";
import { Button } from "../../../src/ui/base-ui/button.js";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemGroupHeader,
  ItemGroupLabel,
  ItemMedia,
  ItemTitle,
} from "../../../src/ui/base-ui/item.js";
import { Switch } from "../../../src/ui/base-ui/switch.js";
import { propControls } from "../prop-controls.js";
import guide from "./item.docs.md?raw";

const controls = propControls(itemProps);

const meta = {
  title: "Components/Item",
  component: Item,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: {
    ...controls.args,
    children: (
      <>
        <ItemMedia framed>
          <IconMail />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Error emails</ItemTitle>
          <ItemDescription>Send me an email when a run fails.</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Switch defaultChecked aria-label="Error emails" />
        </ItemActions>
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
} satisfies Meta<typeof Item>;

export default meta;

type Story = StoryObj<typeof meta>;

/** One row with the props from the controls. */
export const Playground: Story = {};

/** A row on its own in each variant, then each group variant. */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        {itemProps.variant.values.map((variant) => (
          <Item key={variant} variant={variant}>
            <ItemContent>
              <ItemTitle>{variant}</ItemTitle>
            </ItemContent>
          </Item>
        ))}
      </div>
      {itemGroupProps.variant.values.map((variant) => (
        <section key={variant}>
          <ItemGroupLabel>Group, {variant}</ItemGroupLabel>
          <ItemGroup variant={variant} role="list">
            {["Ada Lovelace", "Charles Babbage"].map((name) => (
              <Item key={name} role="listitem">
                <ItemMedia>
                  <Avatar color="gray">
                    <AvatarFallback>
                      {name
                        .split(" ")
                        .map((part) => part[0])
                        .join("")}
                    </AvatarFallback>
                  </Avatar>
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{name}</ItemTitle>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        </section>
      ))}
    </div>
  ),
};

/**
 * An outlined list of setting rows under a header with its action, framed
 * icons, a badge in a title, and a row that is a button.
 */
export const States: Story = {
  render: () => (
    <section>
      <ItemGroupHeader>
        <ItemGroupLabel>Notifications</ItemGroupLabel>
        <Button variant="ghost" color="gray" size="sm">
          Reset
        </Button>
      </ItemGroupHeader>
      <ItemGroup variant="outline">
        <Item>
          <ItemMedia framed>
            <IconMail />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>
              Error emails{" "}
              <Badge variant="outline" color="gray">
                Beta
              </Badge>
            </ItemTitle>
            <ItemDescription>
              Send me an email when a run fails.
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch defaultChecked aria-label="Error emails" />
          </ItemActions>
        </Item>
        <Item>
          <ItemMedia framed>
            <IconBell />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>Desktop alerts</ItemTitle>
            <ItemDescription>
              Show a notification on this device.
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Switch aria-label="Desktop alerts" />
          </ItemActions>
        </Item>
        <Item>
          <ItemMedia framed>
            <IconKey />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>API keys</ItemTitle>
          </ItemContent>
          <ItemActions>
            <Button variant="surface" color="gray" size="sm">
              Manage
            </Button>
          </ItemActions>
        </Item>
        <Item render={<button type="button" />}>
          <ItemContent>
            <ItemTitle>Notification history</ItemTitle>
          </ItemContent>
          <ItemActions>
            <IconChevronRight aria-hidden />
          </ItemActions>
        </Item>
      </ItemGroup>
    </section>
  ),
};
