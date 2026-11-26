import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { ColorSwatch } from "../../../src/ui/base-ui/color-swatch.js";
import { Grid, Inline, Stack } from "../../../src/ui/base-ui/layout.js";
import guide from "./layout.docs.md?raw";

export default {
  title: "Layout/Stack, Inline and Grid",
  component: Grid,
  subcomponents: { Stack, Inline },
  parameters: {
    docs: {
      description: {
        component: guide,
      },
    },
  },
} satisfies Meta;
export const Responsive: StoryObj = {
  render: () => (
    <Grid
      render={<section aria-label="Color tokens" />}
      columns="repeat(auto-fit, minmax(min(100%, 12rem), 1fr))"
      gap={3}
    >
      {[
        ["Brand", "var(--brand-9)"],
        ["Canvas", "var(--surface-canvas)"],
        ["Raised", "var(--surface-raised)"],
      ].map(([name, paint]) => (
        <Stack
          key={name}
          render={<article />}
          gap={3}
          className="rounded-card border border-line p-4"
        >
          <Inline gap={2} wrap>
            <ColorSwatch value={paint} />
            <h3 className="type-label">{name}</h3>
          </Inline>
          <code className="text-xs text-fg-muted">{paint}</code>
        </Stack>
      ))}
    </Grid>
  ),
  play: async ({ canvas }) => {
    const grid = canvas.getByRole("region", { name: "Color tokens" });
    await expect(grid).toHaveStyle({ display: "grid" });
    const cards = canvas.getAllByRole("article");
    await expect(cards).toHaveLength(3);
    const originalSize = grid.style.inlineSize;
    try {
      grid.style.inlineSize = "10rem";
      await expect(grid.scrollWidth).toBeLessThanOrEqual(grid.clientWidth);
      const narrow = cards.map((card) => card.getBoundingClientRect());
      await expect(narrow[1].top).toBeGreaterThan(narrow[0].bottom);
      await expect(narrow[2].top).toBeGreaterThan(narrow[1].bottom);

      grid.style.inlineSize = "42rem";
      const wide = cards.map((card) => card.getBoundingClientRect());
      await expect(wide[1].top).toBe(wide[0].top);
      await expect(wide[2].top).toBe(wide[0].top);
    } finally {
      grid.style.inlineSize = originalSize;
    }
  },
};
