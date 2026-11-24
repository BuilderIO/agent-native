import { dataListProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Badge } from "../../../src/ui/base-ui/badge.js";
import { Button } from "../../../src/ui/base-ui/button.js";
import {
  DataList,
  DataListItem,
  DataListLabel,
  DataListValue,
} from "../../../src/ui/base-ui/data-list.js";
import { propControls } from "../prop-controls.js";
import guide from "./data-list.docs.md?raw";

const controls = propControls(dataListProps);

function RunDetails() {
  return (
    <>
      <DataListItem>
        <DataListLabel>Status</DataListLabel>
        <DataListValue>
          <Badge color="success">Done</Badge>
        </DataListValue>
      </DataListItem>
      <DataListItem>
        <DataListLabel>Run ID</DataListLabel>
        <DataListValue>
          <span className="flex items-center gap-2">
            run_8f2a91
            <Button size="sm" variant="ghost" color="gray">
              Copy
            </Button>
          </span>
        </DataListValue>
      </DataListItem>
      <DataListItem>
        <DataListLabel>Owner</DataListLabel>
        <DataListValue>Ada Lovelace</DataListValue>
      </DataListItem>
      <DataListItem>
        <DataListLabel>Prompt</DataListLabel>
        <DataListValue>
          Summarize yesterday's support tickets and file the urgent ones.
        </DataListValue>
      </DataListItem>
    </>
  );
}

const meta = {
  title: "Components/Data List",
  component: DataList,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: { ...controls.args, children: <RunDetails /> },
  argTypes: controls.argTypes,
  decorators: [
    (Story) => (
      <div className="w-120">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DataList>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The list with the props from the controls. */
export const Playground: Story = {};

/** Labels beside their values, or above them. */
export const Orientation: Story = {
  render: () => (
    <div className="flex flex-col gap-8">
      {dataListProps.orientation.values.map((orientation) => (
        <DataList key={orientation} orientation={orientation}>
          <RunDetails />
        </DataList>
      ))}
    </div>
  ),
};

/**
 * Trim removes the half-leading above the first row, below the last, or
 * both, so the list sits flush with the border drawn here.
 */
export const Trim: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {dataListProps.trim.values.map((trim) => (
        <div key={trim} className="flex flex-col gap-1">
          <span className="text-xs text-fg-muted">{trim}</span>
          <div className="border border-line">
            <DataList trim={trim}>
              <DataListItem>
                <DataListLabel>Owner</DataListLabel>
                <DataListValue>Ada Lovelace</DataListValue>
              </DataListItem>
              <DataListItem>
                <DataListLabel>Model</DataListLabel>
                <DataListValue>Sonnet</DataListValue>
              </DataListItem>
            </DataList>
          </div>
        </div>
      ))}
    </div>
  ),
};
