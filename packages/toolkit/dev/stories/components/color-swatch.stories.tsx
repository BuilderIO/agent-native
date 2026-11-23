import { colorSwatchProps } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { ColorSwatch } from "../../../src/ui/base-ui/color-swatch.js";
import { propControls } from "../prop-controls.js";
import guide from "./color-swatch.docs.md?raw";

const controls = propControls(colorSwatchProps);
const meta = {
  title: "Components/Color Swatch",
  parameters: { docs: { description: { component: guide } } },
  component: ColorSwatch,
  args: {
    ...controls.args,
    value: "var(--brand-9)",
    role: "img",
    "aria-label": "Current paint",
  },
  argTypes: { ...controls.argTypes, value: { control: "text" } },
} satisfies Meta<typeof ColorSwatch>;
export default meta;
export const Playground: StoryObj<typeof meta> = {};
export const Transparency: StoryObj<typeof meta> = {
  render: () => (
    <div className="flex gap-2">
      {["transparent", "var(--brand-a5)", "var(--brand-9)"].map(
        (value, index) => (
          <ColorSwatch
            key={value}
            value={value}
            role="img"
            aria-label={["Clear", "Translucent", "Opaque"][index]}
          />
        ),
      )}
    </div>
  ),
};
