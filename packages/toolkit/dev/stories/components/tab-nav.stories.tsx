import { COLORS, tabNavProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  IconActivity,
  IconLayoutGrid,
  IconSettings,
} from "@tabler/icons-react";
import { useState } from "react";

import {
  TabNav,
  TabNavLink,
  type TabNavProps,
} from "../../../src/ui/base-ui/tab-nav.js";
import { propControls } from "../prop-controls.js";
import guide from "./tab-nav.docs.md?raw";

const controls = propControls(tabNavProps);

const PAGES = ["Overview", "Activity", "Settings"] as const;

function Example(props: TabNavProps) {
  const [current, setCurrent] = useState<string>(PAGES[0]);
  return (
    <TabNav aria-label="Project" {...props}>
      {PAGES.map((page) => (
        <TabNavLink
          key={page}
          href={`#${page.toLowerCase()}`}
          active={page === current}
          onClick={(event) => {
            event.preventDefault();
            setCurrent(page);
          }}
        >
          {page}
        </TabNavLink>
      ))}
    </TabNav>
  );
}

const meta = {
  title: "Components/Tab Nav",
  component: TabNav,
  parameters: { docs: { description: { component: guide } }, layout: "padded" },
  args: controls.args,
  argTypes: controls.argTypes,
  render: (args) => <Example {...args} />,
} satisfies Meta<typeof TabNav>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The links with the props from the controls. */
export const Playground: Story = {};

/** The current page's underline in every color, then in high contrast. */
export const Colors: Story = {
  render: (args) => (
    <div className="grid grid-cols-2 gap-6">
      {[false, true].map((highContrast) => (
        <div key={String(highContrast)} className="flex flex-col gap-6">
          {COLORS.map((color) => (
            <div key={color} className="flex flex-col gap-1">
              <span className="text-xs text-fg-muted">
                {color}
                {highContrast ? ", high contrast" : ""}
              </span>
              <Example
                {...args}
                color={color}
                highContrast={highContrast}
                aria-label={`Project, ${color}${highContrast ? ", high contrast" : ""}`}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
};

/** The links at the start, center and end of a full-width row. */
export const Justify: Story = {
  render: (args) => (
    <div className="flex w-[480px] flex-col gap-6">
      {tabNavProps.justify.values.map((justify) => (
        <Example
          key={justify}
          {...args}
          justify={justify}
          aria-label={`Project, ${justify}`}
        />
      ))}
    </div>
  ),
};

/** Icons beside the labels. */
export const WithIcons: Story = {
  render: (args) => (
    <TabNav aria-label="Project" {...args}>
      <TabNavLink
        href="#overview"
        active
        onClick={(event) => event.preventDefault()}
      >
        <IconLayoutGrid aria-hidden /> Overview
      </TabNavLink>
      <TabNavLink href="#activity" onClick={(event) => event.preventDefault()}>
        <IconActivity aria-hidden /> Activity
      </TabNavLink>
      <TabNavLink href="#settings" onClick={(event) => event.preventDefault()}>
        <IconSettings aria-hidden /> Settings
      </TabNavLink>
    </TabNav>
  ),
};
