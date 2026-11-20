import { COLORS, tabsListProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconCode, IconEye, IconTerminal } from "@tabler/icons-react";

import {
  Tabs,
  TabsList,
  type TabsListProps,
  TabsPanel,
  TabsTab,
} from "../../../src/ui/base-ui/tabs.js";
import { propControls } from "../prop-controls.js";

const controls = propControls(tabsListProps);

const meta = {
  title: "Components/Tabs",
  component: TabsList,
  parameters: { layout: "padded" },
  args: controls.args,
  argTypes: controls.argTypes,
} satisfies Meta<typeof TabsList>;

export default meta;

type Story = StoryObj<typeof meta>;

function Example(props: TabsListProps & { panels?: boolean }) {
  const { panels = false, ...list } = props;
  return (
    <Tabs defaultValue="code">
      <TabsList aria-label="View" {...list}>
        <TabsTab value="code">Code</TabsTab>
        <TabsTab value="preview">Preview</TabsTab>
        <TabsTab value="logs">Logs</TabsTab>
      </TabsList>
      {panels ? (
        <>
          <TabsPanel value="code" className="text-2 text-fg-muted">
            The source of the current file.
          </TabsPanel>
          <TabsPanel value="preview" className="text-2 text-fg-muted">
            The rendered page.
          </TabsPanel>
          <TabsPanel value="logs" className="text-2 text-fg-muted">
            The build output.
          </TabsPanel>
        </>
      ) : null}
    </Tabs>
  );
}

/** The tabs with the list props from the controls. */
export const Playground: Story = {
  render: (args) => <Example {...args} panels />,
};

/** md and lg: 24 and 32px triggers. */
export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-col gap-6">
      {tabsListProps.size.values.map((size) => (
        <Example key={size} {...args} size={size} />
      ))}
    </div>
  ),
};

/** The indicator in every color, then in high contrast. */
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
              <Example {...args} color={color} highContrast={highContrast} />
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
};

/** The triggers at the start, center and end of a full-width list. */
export const Justify: Story = {
  render: (args) => (
    <div className="flex w-[480px] flex-col gap-6">
      {tabsListProps.justify.values.map((justify) => (
        <Example key={justify} {...args} justify={justify} />
      ))}
    </div>
  ),
};

/** Icons beside the labels, a disabled tab, and vertical tabs. */
export const States: Story = {
  render: (args) => (
    <div className="flex flex-col gap-10">
      <Tabs defaultValue="code">
        <TabsList aria-label="View" {...args}>
          <TabsTab value="code">
            <IconCode aria-hidden /> Code
          </TabsTab>
          <TabsTab value="preview">
            <IconEye aria-hidden /> Preview
          </TabsTab>
          <TabsTab value="logs" disabled>
            <IconTerminal aria-hidden /> Logs
          </TabsTab>
        </TabsList>
      </Tabs>
      <Tabs defaultValue="general" orientation="vertical">
        <TabsList aria-label="Settings" {...args}>
          <TabsTab value="general">General</TabsTab>
          <TabsTab value="members">Members</TabsTab>
          <TabsTab value="billing">Billing</TabsTab>
        </TabsList>
        <TabsPanel value="general" className="text-2 text-fg-muted">
          General settings.
        </TabsPanel>
        <TabsPanel value="members" className="text-2 text-fg-muted">
          Who has access.
        </TabsPanel>
        <TabsPanel value="billing" className="text-2 text-fg-muted">
          Plan and invoices.
        </TabsPanel>
      </Tabs>
    </div>
  ),
};
