import { COLORS } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  IconHome,
  IconInbox,
  IconMessageCircle,
  IconSettings,
} from "@tabler/icons-react";

import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "../../../src/ui/base-ui/navigation-menu.js";
import guide from "./navigation-menu.docs.md?raw";

const meta = {
  title: "Components/Navigation Menu",
  component: NavigationMenu,
  parameters: { docs: { description: { component: guide } }, layout: "padded" },
} satisfies Meta;

export default meta;

const PLACES = [
  { label: "Home", icon: <IconHome />, active: true },
  { label: "Inbox", icon: <IconInbox />, count: "12" },
  { label: "Settings", icon: <IconSettings /> },
] as const;

function Places({ label = "App" }: { label?: string }) {
  return (
    <NavigationMenu orientation="vertical" aria-label={label}>
      <NavigationMenuList>
        {PLACES.map((place) => (
          <NavigationMenuItem key={place.label}>
            <NavigationMenuLink
              href="#"
              active={"active" in place}
              leading={place.icon}
              trailing={"count" in place ? place.count : undefined}
            >
              {place.label}
            </NavigationMenuLink>
          </NavigationMenuItem>
        ))}
      </NavigationMenuList>
    </NavigationMenu>
  );
}

/**
 * A vertical list of places with the current one marked, a nested list, a
 * disabled place, and an action drawn as a link.
 */
export const States: StoryObj = {
  render: () => (
    <div className="w-60">
      <NavigationMenu orientation="vertical" aria-label="App">
        <NavigationMenuList>
          {PLACES.map((place) => (
            <NavigationMenuItem key={place.label}>
              <NavigationMenuLink
                href="#"
                active={"active" in place}
                leading={place.icon}
                trailing={"count" in place ? place.count : undefined}
              >
                {place.label}
              </NavigationMenuLink>
              {place.label === "Settings" ? (
                <NavigationMenuList>
                  <NavigationMenuItem>
                    <NavigationMenuLink href="#">Profile</NavigationMenuLink>
                  </NavigationMenuItem>
                  <NavigationMenuItem>
                    <NavigationMenuLink href="#" aria-disabled="true">
                      Billing
                    </NavigationMenuLink>
                  </NavigationMenuItem>
                </NavigationMenuList>
              ) : null}
            </NavigationMenuItem>
          ))}
          <NavigationMenuItem>
            <NavigationMenuLink
              leading={<IconMessageCircle />}
              render={<button type="button" />}
            >
              Send feedback
            </NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>
    </div>
  ),
};

/** The current place takes the nearest color's soft tint and text step. */
export const Colors: StoryObj = {
  render: () => (
    <div className="grid grid-cols-3 gap-6">
      {COLORS.map((color) => (
        <div
          key={color}
          data-color={color}
          className="flex w-48 flex-col gap-1"
        >
          <span className="text-xs text-fg-muted">{color}</span>
          <Places label={`App, ${color}`} />
        </div>
      ))}
    </div>
  ),
};
