import { COLORS, tabsListProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconCode, IconEye, IconTerminal } from "@tabler/icons-react";
import { expect, waitFor } from "storybook/test";

import {
  Tabs,
  TabsList,
  type TabsListProps,
  type TabsProps,
  TabsPanel,
  TabsTab,
} from "../../../src/ui/base-ui/tabs.js";
import { propControls } from "../prop-controls.js";
import guide from "./tabs.docs.md?raw";

const controls = propControls(tabsListProps);

const meta = {
  title: "Components/Tabs",
  component: TabsList,
  parameters: { docs: { description: { component: guide } }, layout: "padded" },
  args: controls.args,
  argTypes: controls.argTypes,
} satisfies Meta<typeof TabsList>;

export default meta;

type Story = StoryObj<typeof meta>;

function Example(
  props: TabsListProps & { panels?: boolean; variant?: TabsProps["variant"] },
) {
  const { panels = false, variant, ...list } = props;
  return (
    <Tabs defaultValue="code" variant={variant}>
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

/** A panel strip scrolls to reveal the focused tab before it is activated. */
export const Framed: Story = {
  render: (args) => (
    <div className="max-w-32">
      <Example {...args} variant="framed" panels />
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    const list = canvas.getByRole("tablist", { name: "View" });
    const first = canvas.getByRole("tab", { name: "Code" });
    const last = canvas.getByRole("tab", { name: "Logs" });
    await userEvent.tab();
    await userEvent.keyboard("{End}");
    await expect(last).toHaveFocus();
    await expect(first).toHaveAttribute("aria-selected", "true");
    const rail = list.getBoundingClientRect();
    const focused = last.getBoundingClientRect();
    await expect(rail.height).toBe(32);
    await expect(focused.height).toBe(24);
    await expect(focused.top - rail.top).toBe(4);
    await expect(focused.left).toBeGreaterThanOrEqual(rail.left - 1);
    await expect(focused.right).toBeLessThanOrEqual(rail.right + 1);
    await userEvent.keyboard("{Enter}");
    const panel = canvas.getByRole("tabpanel", { name: "Logs" });
    await expect(panel.getBoundingClientRect().top).toBeCloseTo(rail.bottom, 0);
    await expect(getComputedStyle(last).backgroundColor).toBe(
      getComputedStyle(panel).backgroundColor,
    );
  },
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

/** A single row scrolls when its tabs no longer fit. */
export const Overflow: Story = {
  args: { justify: "end" },
  render: (args) => (
    <div className="max-w-24">
      <Example {...args} panels />
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    const list = canvas.getByRole("tablist", { name: "View" });
    const first = canvas.getByRole("tab", { name: "Code" });
    const last = canvas.getByRole("tab", { name: "Logs" });
    await userEvent.tab();
    await expect(first).toHaveFocus();
    for (const tab of [last, first]) {
      await userEvent.keyboard(tab === last ? "{End}{Enter}" : "{Home}{Enter}");
      await expect(tab).toHaveFocus();
      const viewport = list.getBoundingClientRect();
      const item = tab.getBoundingClientRect();
      await expect(item.left).toBeGreaterThanOrEqual(viewport.left - 1);
      await expect(item.right).toBeLessThanOrEqual(viewport.right + 1);
    }
  },
};

/** Narrow lists keep the selection underline on its own row. */
export const Wrapped: Story = {
  args: { wrap: "wrap" },
  render: (args) => (
    <div className="max-w-32">
      <Example {...args} panels />
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    const list = canvas.getByRole("tablist", { name: "View" });
    const indicator = list.querySelector(".tabs-indicator");
    if (!indicator) throw new Error("Missing tab indicator");
    const checkSelection = async (name: string) => {
      const selected = canvas.getByRole("tab", { name, selected: true });
      await waitFor(async () => {
        const tab = selected.getBoundingClientRect();
        const line = indicator.getBoundingClientRect();
        await expect(Math.abs(line.bottom - tab.bottom)).toBeLessThan(1);
        await expect(Math.abs(line.left - tab.left)).toBeLessThan(1);
        await expect(Math.abs(line.width - tab.width)).toBeLessThan(1);
      });
    };
    await checkSelection("Code");
    await userEvent.click(canvas.getByRole("tab", { name: "Logs" }));
    await checkSelection("Logs");
    await userEvent.keyboard("{Home}{Enter}");
    await checkSelection("Code");
  },
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
