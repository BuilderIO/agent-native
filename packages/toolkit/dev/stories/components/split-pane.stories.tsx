import type { Meta, StoryObj } from "@storybook/react-vite";
import { useId, useState } from "react";
import { expect, waitFor } from "storybook/test";

import { Stack } from "../../../src/ui/base-ui/layout.js";
import {
  SplitPane,
  type SplitPaneProps,
} from "../../../src/ui/base-ui/split-pane.js";
import guide from "./split-pane.docs.md?raw";

const points = ["Introduction", "Typography", "Interaction"];
function Example({
  dir = "ltr",
  axis = "inline",
  side = "start",
  ...props
}: Partial<SplitPaneProps>) {
  const id = useId();
  const [size, setSize] = useState(200);
  return (
    <SplitPane
      {...props}
      dir={dir}
      axis={axis}
      side={side}
      label={axis === "block" ? "Outline height" : "Outline width"}
      className="overflow-hidden rounded-card border border-line bg-surface-canvas"
      style={{ height: 360 }}
      size={size}
      minSize={96}
      maxSize={320}
      step={8}
      collapsible
      onSizeChange={(next, { phase }) => {
        if (phase === "commit") setSize(next);
      }}
      pane={
        <Stack
          render={<nav aria-label="Outline" />}
          gap={2}
          className="min-h-full bg-surface-nav p-4"
        >
          <h2 className="type-label">Outline</h2>
          {points.map((p) => (
            <a className="text-xs text-fg-muted" key={p} href={"#" + id + p}>
              {p}
            </a>
          ))}
        </Stack>
      }
    >
      <Stack className="p-4" gap={5}>
        {points.map((p) => (
          <section id={id + p} key={p}>
            <h3 className="type-label">{p}</h3>
          </section>
        ))}
      </Stack>
    </SplitPane>
  );
}
export default {
  title: "Layout/Split Pane",
  component: SplitPane,
  parameters: {
    docs: {
      description: {
        component: guide,
      },
    },
  },
} satisfies Meta;
export const InlineStart: StoryObj = { render: () => <Example /> };
export const InlineEnd: StoryObj = { render: () => <Example side="end" /> };
export const Disabled: StoryObj = {
  render: () => <Example disabled />,
  play: async ({ canvas, userEvent }) => {
    const grip = canvas.getByRole("separator", { name: "Outline width" });
    await expect(grip).toHaveAttribute("aria-disabled", "true");
    await expect(grip).toHaveAttribute("tabindex", "-1");
    canvas.getByRole("link", { name: "Typography" }).focus();
    await userEvent.tab();
    await expect(
      canvas.getByRole("link", { name: "Interaction" }),
    ).toHaveFocus();
  },
};
export const BlockEnd: StoryObj = {
  render: () => <Example axis="block" side="end" />,
  play: async ({ canvas, userEvent }) => {
    const grip = canvas.getByRole("separator", { name: "Outline height" });
    await expect(grip).toHaveAttribute("aria-orientation", "horizontal");
    grip.focus();
    await userEvent.keyboard("{ArrowUp}");
    await expect(grip).toHaveAttribute("aria-valuenow", "208");
    await userEvent.keyboard("{Home}");
    await expect(grip).toHaveAttribute("aria-valuenow", "0");
    await expect(canvas.queryByRole("navigation")).not.toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    await expect(grip).toHaveAttribute("aria-valuenow", "208");
    await expect(
      canvas.getByRole("navigation", { name: "Outline" }),
    ).toBeInTheDocument();
  },
};
export const RightToLeft: StoryObj = {
  render: () => <Example dir="rtl" />,
  play: async ({ canvas, userEvent }) => {
    const grip = canvas.getByRole("separator", { name: "Outline width" });
    grip.focus();
    await userEvent.keyboard("{ArrowLeft}");
    await expect(grip).toHaveAttribute("aria-valuenow", "208");
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    await expect(grip).toHaveAttribute("aria-valuenow", "128");
    await userEvent.keyboard("{End}");
    await expect(grip).toHaveAttribute("aria-valuenow", "320");
  },
};

export const Sideways: StoryObj = {
  render: () => (
    <SplitPane
      style={{ writingMode: "sideways-lr", width: 240, height: 360 }}
      label="Outline size"
      defaultSize={160}
      pane={<nav aria-label="Outline">Outline</nav>}
    >
      Document
    </SplitPane>
  ),
  play: async ({ canvas, userEvent }) => {
    const grip = canvas.getByRole("separator", { name: "Outline size" });
    await expect(grip).toHaveAttribute("aria-orientation", "horizontal");
    grip.focus();
    const before = grip.getBoundingClientRect().top;
    await userEvent.keyboard("{ArrowDown}");
    await expect(grip.getBoundingClientRect().top).toBe(before + 8);
    await expect(grip).toHaveAttribute("aria-valuenow", "152");
    await userEvent.keyboard("{ArrowUp}");
    await expect(grip.getBoundingClientRect().top).toBe(before);
  },
};

export const Nested: StoryObj = {
  render: () => (
    <SplitPane
      label="Outline width"
      defaultSize={160}
      minSize={96}
      maxSize={320}
      pane={<h2 className="p-3 type-label">Outline</h2>}
      style={{ height: 280 }}
    >
      <SplitPane
        label="Inspector width"
        side="end"
        defaultSize={128}
        minSize={96}
        maxSize={220}
        className="h-full"
        pane={<h2 className="p-3 type-label">Inspector</h2>}
      >
        <article className="p-3">Canvas</article>
      </SplitPane>
    </SplitPane>
  ),
};

export const FractionalLimits: StoryObj<typeof SplitPane> = {
  render: () => (
    <SplitPane
      label="Inspector width"
      defaultSize={160}
      minSize={80}
      minContentSize={120}
      style={
        {
          inlineSize: 400.75,
          blockSize: 180,
          padding: 2.25,
          border: "1px solid var(--line-default)",
          boxSizing: "border-box",
          "--split-pane-handle-size": "7.25px",
        } as React.CSSProperties
      }
      pane="Inspector"
    >
      Document
    </SplitPane>
  ),
  play: async ({ canvas, userEvent }) => {
    const grip = canvas.getByRole("separator", { name: "Inspector width" });
    const content = canvas.getByText("Document");
    await waitFor(() => expect(grip).toHaveAttribute("aria-valuemax", "267"));
    grip.focus();
    await userEvent.keyboard("{End}");
    await expect(content.getBoundingClientRect().width).toBe(120);
    await expect(grip).toHaveAttribute("aria-valuenow", "267");
    await userEvent.keyboard("{Home}");
    await expect(grip).toHaveAttribute("aria-valuenow", "80");
  },
};
