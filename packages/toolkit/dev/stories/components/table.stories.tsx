import { tableProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

import { Badge } from "../../../src/ui/base-ui/badge.js";
import { Card } from "../../../src/ui/base-ui/card.js";
import { Inset } from "../../../src/ui/base-ui/inset.js";
import {
  Table,
  TableBody,
  TableCell,
  TableColumnHeaderCell,
  TableHeader,
  TableRow,
  TableRowHeaderCell,
} from "../../../src/ui/base-ui/table.js";
import { propControls } from "../prop-controls.js";
import guide from "./table.docs.md?raw";

const controls = propControls(tableProps);

const RUNS = [
  { name: "Nightly sync", status: "Done", tokens: "4,210" },
  { name: "Weekly digest", status: "Running", tokens: "1,082" },
  { name: "Inbox triage", status: "Failed", tokens: "316" },
] as const;

const STATUS_COLOR = {
  Done: "success",
  Running: "info",
  Failed: "danger",
} as const;

function RunRows() {
  return (
    <>
      <TableHeader>
        <TableRow>
          <TableColumnHeaderCell>Run</TableColumnHeaderCell>
          <TableColumnHeaderCell>Status</TableColumnHeaderCell>
          <TableColumnHeaderCell justify="end">Tokens</TableColumnHeaderCell>
        </TableRow>
      </TableHeader>
      <TableBody>
        {RUNS.map((run) => (
          <TableRow key={run.name} align="center">
            <TableRowHeaderCell>{run.name}</TableRowHeaderCell>
            <TableCell>
              <Badge color={STATUS_COLOR[run.status]}>{run.status}</Badge>
            </TableCell>
            <TableCell justify="end">{run.tokens}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </>
  );
}

const meta = {
  title: "Components/Table",
  component: Table,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: { ...controls.args, children: <RunRows /> },
  argTypes: controls.argTypes,
  decorators: [
    (Story) => (
      <div className="w-140">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Table>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The table with the props from the controls. */
export const Playground: Story = {};

/** Surface frames the table with a tinted header; ghost is bare rows. */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      {tableProps.variant.values.map((variant) => (
        <div key={variant} className="flex flex-col gap-2">
          <span className="text-xs text-fg-muted">{variant}</span>
          <Table variant={variant}>
            <RunRows />
          </Table>
        </div>
      ))}
    </div>
  ),
};

/**
 * Rows that open their run are focusable buttons: they take the hover fill
 * and a focus ring, and the selected one keeps its fill. Static rows take
 * neither.
 */
export const States: Story = {
  render: function InteractiveRows() {
    const [selected, setSelected] = React.useState<string>(RUNS[0].name);
    return (
      <Table variant="surface">
        <TableHeader>
          <TableRow>
            <TableColumnHeaderCell>Run</TableColumnHeaderCell>
            <TableColumnHeaderCell justify="end">Tokens</TableColumnHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {RUNS.map((run) => (
            <TableRow
              key={run.name}
              tabIndex={0}
              role="button"
              aria-pressed={selected === run.name}
              onClick={() => setSelected(run.name)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelected(run.name);
                }
              }}
            >
              <TableCell>{run.name}</TableCell>
              <TableCell justify="end">{run.tokens}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  },
};

/**
 * `layout="fixed"` with cell widths, and a table wider than its frame,
 * which scrolls sideways.
 */
export const Widths: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <Table layout="fixed" variant="surface">
        <TableHeader>
          <TableRow>
            <TableColumnHeaderCell width="50%">Run</TableColumnHeaderCell>
            <TableColumnHeaderCell>Owner</TableColumnHeaderCell>
            <TableColumnHeaderCell width="96px" justify="end">
              Tokens
            </TableColumnHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {RUNS.map((run) => (
            <TableRow key={run.name}>
              <TableRowHeaderCell>{run.name}</TableRowHeaderCell>
              <TableCell>Ada Lovelace</TableCell>
              <TableCell justify="end">{run.tokens}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Table variant="surface">
        <TableHeader>
          <TableRow>
            {["Run", "Owner", "Model", "Started", "Finished", "Tokens"].map(
              (column) => (
                <TableColumnHeaderCell key={column} minWidth="140px">
                  {column}
                </TableColumnHeaderCell>
              ),
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {RUNS.map((run) => (
            <TableRow key={run.name}>
              <TableRowHeaderCell>{run.name}</TableRowHeaderCell>
              <TableCell>Ada Lovelace</TableCell>
              <TableCell>Sonnet</TableCell>
              <TableCell>09:00</TableCell>
              <TableCell>09:04</TableCell>
              <TableCell>{run.tokens}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  ),
};

/** In a Card's Inset, the first and last columns line up with the card's text. */
export const InCard: Story = {
  render: () => (
    <Card>
      <div className="flex flex-col gap-3">
        <span className="text-sm font-medium">Recent runs</span>
        <Inset side="x">
          <Table>
            <RunRows />
          </Table>
        </Inset>
      </div>
    </Card>
  ),
};
