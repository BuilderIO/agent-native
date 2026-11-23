import { insetProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Card } from "../../../src/ui/base-ui/card.js";
import { Inset, type InsetProps } from "../../../src/ui/base-ui/inset.js";
import { propControls } from "../prop-controls.js";
import guide from "./inset.docs.md?raw";

const controls = propControls(insetProps);

function Media({ className = "h-28" }: { className?: string }) {
  return (
    <div
      className={className}
      style={{ background: "var(--gradient-brand)" }}
    />
  );
}

type Side = NonNullable<InsetProps["side"]>;

const LAYOUT: Record<Side, { row: boolean; mediaFirst: boolean }> = {
  all: { row: false, mediaFirst: true },
  x: { row: false, mediaFirst: false },
  y: { row: true, mediaFirst: false },
  top: { row: false, mediaFirst: true },
  bottom: { row: false, mediaFirst: false },
  left: { row: true, mediaFirst: true },
  right: { row: true, mediaFirst: false },
};

function InsetCard({ side, clip }: Pick<InsetProps, "side" | "clip">) {
  const { row, mediaFirst } = LAYOUT[side ?? "all"];
  const media = (
    <Inset side={side} clip={clip} className={row ? "w-24 shrink-0" : ""}>
      <Media className={row ? "h-full" : "h-20"} />
    </Inset>
  );
  const label =
    side === "all" ? null : <span className="flex-1 text-sm">{side}</span>;
  return (
    <Card>
      <div className={row ? "flex min-h-24 gap-3" : "flex flex-col gap-3"}>
        {mediaFirst ? media : label}
        {mediaFirst ? label : media}
        {side === "x" ? <span className="text-sm">Weekly usage</span> : null}
      </div>
    </Card>
  );
}

const meta = {
  title: "Components/Inset",
  component: Inset,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: controls.args,
  argTypes: controls.argTypes,
  render: (args) => (
    <div className="w-80">
      <InsetCard {...args} />
    </div>
  ),
} satisfies Meta<typeof Inset>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Media in a card with the props from the controls. */
export const Playground: Story = {};

/** Each side it can run to. `all` is for a card that holds only media. */
export const Sides: Story = {
  render: () => (
    <div className="grid w-170 grid-cols-2 items-start gap-4">
      {insetProps.side.values.map((side) => (
        <InsetCard key={side} side={side} />
      ))}
    </div>
  ),
};

/** `border-box` stops inside the card's hairline; `padding-box` runs under it. */
export const Clip: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-4">
      {insetProps.clip.values.map((clip) => (
        <div key={clip} className="flex flex-col gap-1">
          <span className="text-xs text-fg-muted">{clip}</span>
          <InsetCard side="top" clip={clip} />
        </div>
      ))}
    </div>
  ),
};
