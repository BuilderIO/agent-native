import { codeProps, COLORS } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Code } from "../../../src/ui/base-ui/code.js";
import { Link } from "../../../src/ui/base-ui/link.js";
import { Text } from "../../../src/ui/base-ui/text.js";
import { propControls } from "../prop-controls.js";
import guide from "./code.docs.md?raw";

const controls = propControls(codeProps);

const meta = {
  title: "Typography/Code",
  component: Code,
  parameters: { layout: "padded", docs: { description: { component: guide } } },
  args: { ...controls.args, children: "pnpm install" },
  argTypes: controls.argTypes,
} satisfies Meta<typeof Code>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Code with the props from the controls. */
export const Playground: Story = {};

const VARIANTS = codeProps.variant.values;

/** Every variant in every color, then in high contrast. */
export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {[false, true].map((highContrast) =>
        VARIANTS.map((variant) => (
          <div
            key={`${variant}-${String(highContrast)}`}
            className="flex items-center gap-3"
          >
            {COLORS.map((color) => (
              <Code
                key={color}
                variant={variant}
                color={color}
                highContrast={highContrast}
              >
                {color}
              </Code>
            ))}
            <span className="text-xs text-fg-muted">
              {variant}
              {highContrast ? ", high contrast" : ""}
            </span>
          </div>
        )),
      )}
    </div>
  ),
};

/** In running text and inside a link, where it takes a hover fill. */
export const InText: Story = {
  render: () => (
    <div className="flex w-140 flex-col gap-3">
      <Text as="p" size="3">
        Run <Code>pnpm install</Code> before <Code variant="ghost">dev</Code>.
      </Text>
      <Text as="p" size="2">
        See{" "}
        <Link href="#">
          <Code>splitProps</Code>
        </Link>{" "}
        for how props become attributes.
      </Text>
    </div>
  ),
};

const LONG_SAMPLE =
  "pnpm --filter @agent-native/toolkit exec vitest run src/ui/base-ui --reporter verbose";

/** Truncate keeps one line inside a narrow block; wrap chooses how lines break. */
export const TruncateAndWrap: Story = {
  render: () => (
    <div className="flex w-72 flex-col gap-4">
      <div className="flex">
        <Code truncate>{LONG_SAMPLE}</Code>
      </div>
      {codeProps.wrap.values.map((wrap) => (
        <div key={wrap} className="flex flex-col gap-1">
          <span className="text-xs text-fg-muted">{wrap}</span>
          <Text as="p" size="2">
            <Code wrap={wrap}>{LONG_SAMPLE}</Code>
          </Text>
        </div>
      ))}
    </div>
  ),
};
