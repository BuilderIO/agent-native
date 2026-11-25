import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import * as React from "react";
import { expect, waitFor, within } from "storybook/test";

import { Button, IconButton } from "../../../src/ui/base-ui/button.js";
import {
  Dialog,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../../../src/ui/base-ui/dialog.js";
import {
  Inspector,
  InspectorSection,
  InspectorSectionHeader,
  InspectorContent,
} from "../../../src/ui/base-ui/inspector.js";
import {
  LayoutDimensions,
  resizeLayout,
  type LayoutDimensionsValue,
} from "../../../src/ui/base-ui/layout-properties.js";
import {
  Popover,
  PopoverTrigger,
  PopoverPopup,
  PopoverTitle,
} from "../../../src/ui/base-ui/popover.js";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "../../../src/ui/base-ui/select.js";
import { ThemeProvider } from "../../../src/ui/base-ui/theme-provider.js";
import guide from "./themed-inspector.docs.md?raw";

const presets = [
  { label: "Square", value: "1:1", ratio: 1 },
  { label: "Portrait", value: "3:4", ratio: 3 / 4 },
  { label: "Landscape", value: "4:3", ratio: 4 / 3 },
];
function Panel({ label }: { label: string }) {
  const [dimensions, setDimensions] = React.useState<LayoutDimensionsValue>({
    width: 320,
    height: 240,
    aspectRatio: null,
  });
  const [preview, setPreview] = React.useState<LayoutDimensionsValue | null>(
    null,
  );
  const value = preview ?? dimensions;
  return (
    <Inspector aria-label={label}>
      <InspectorSection>
        <InspectorSectionHeader>
          <h2 className="font-semibold">Layout</h2>
          <Dialog>
            <DialogTrigger
              aria-label="Frame settings"
              render={<IconButton variant="ghost" color="gray" />}
            >
              <IconAdjustmentsHorizontal />
            </DialogTrigger>
            <DialogPopup aria-describedby={undefined}>
              <DialogTitle>Frame settings</DialogTitle>
              <Popover>
                <PopoverTrigger
                  render={<Button variant="surface" color="gray" />}
                >
                  Aspect ratio
                </PopoverTrigger>
                <PopoverPopup aria-describedby={undefined}>
                  <PopoverTitle>Aspect ratio</PopoverTitle>
                  <Select
                    aria-label="Frame ratio"
                    items={presets}
                    value={
                      presets.find((p) => p.ratio === dimensions.aspectRatio)
                        ?.value ?? null
                    }
                    onValueChange={(v) => {
                      const preset = presets.find((p) => p.value === v);
                      if (preset)
                        setDimensions((d) =>
                          resizeLayout(
                            { ...d, aspectRatio: preset.ratio },
                            { axis: "width", value: d.width },
                          ),
                        );
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose ratio" />
                    </SelectTrigger>
                    <SelectPopup>
                      {presets.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </PopoverPopup>
              </Popover>
            </DialogPopup>
          </Dialog>
        </InspectorSectionHeader>
        <InspectorContent>
          <LayoutDimensions
            width={value.width}
            height={value.height}
            locked={value.aspectRatio !== null}
            onLockChange={(locked) =>
              setDimensions((d) => ({
                ...d,
                aspectRatio:
                  locked && d.width > 0 && d.height > 0
                    ? d.width / d.height
                    : null,
              }))
            }
            onEdit={(e) => {
              setPreview(
                e.phase === "preview"
                  ? resizeLayout(dimensions, e.value)
                  : null,
              );
              if (e.phase === "commit")
                setDimensions((d) => resizeLayout(d, e.value));
            }}
          />
        </InspectorContent>
      </InspectorSection>
    </Inspector>
  );
}
const spacious = {
  "--inspector-section-header-height": "var(--size-7)",
  "--inspector-action-width": "var(--size-5)",
  "--inspector-inset-start": "var(--space-5)",
  "--inspector-inset-end": "var(--space-4)",
  "--inspector-gap": "var(--space-3)",
  "--inspector-section-padding": "var(--space-5)",
  "--control-font-size-3": "var(--font-size-2)",
  fontFamily: "var(--font-family-mono)",
} satisfies React.ComponentProps<typeof ThemeProvider>["style"];
function Treatment({ custom = false }: { custom?: boolean }) {
  return (
    <ThemeProvider
      data-testid={custom ? "library" : "design"}
      appTheme={custom ? "slides" : "design"}
      density={custom ? "comfortable" : "compact"}
      appearance={custom ? "dark" : "light"}
      style={custom ? spacious : undefined}
    >
      <Panel
        label={custom ? "Slide frame properties" : "Design frame properties"}
      />
    </ThemeProvider>
  );
}
export default {
  title: "Patterns/Themed Inspector",
  parameters: { docs: { description: { component: guide } } },
  component: Inspector,
} satisfies Meta;
export const TwoApplications: StoryObj = {
  render: () => (
    <div className="grid max-w-3xl gap-6 sm:grid-cols-2">
      <Treatment />
      <Treatment custom />
    </div>
  ),
};
export const NestedOverlays: StoryObj = {
  ...TwoApplications,
  play: async ({ canvas, userEvent }) => {
    const region = canvas.getByTestId("library");
    const themed = within(region);
    const trigger = themed.getByRole("button", { name: "Frame settings" });
    await userEvent.click(trigger);
    const dialog = await themed.findByRole("dialog", {
      name: "Frame settings",
    });
    const anchor = within(dialog).getByRole("button", { name: "Aspect ratio" });
    await userEvent.click(anchor);
    const select = await themed.findByRole("combobox", { name: "Frame ratio" });
    await userEvent.click(select);
    const list = await themed.findByRole("listbox", { name: "Frame ratio" });
    const option = within(list).getByRole("option", { name: "Square" });
    const inherited = [
      "--inspector-gap",
      "--control-font-size-3",
      "--surface-raised",
      "--fg-default",
    ];
    for (const token of inherited) {
      const expected = getComputedStyle(trigger).getPropertyValue(token).trim();
      await expect(expected).not.toBe("");
      await expect(
        getComputedStyle(option).getPropertyValue(token).trim(),
      ).toBe(expected);
    }
    await userEvent.click(option);
    await waitFor(() => expect(select).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(anchor).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    await expect(themed.getByLabelText("Height")).toHaveValue("320");
    await expect(
      within(canvas.getByTestId("design")).getByLabelText("Height"),
    ).toHaveValue("240");
  },
};
