import { createPalette, paletteCss } from "@agent-native/design-system";
import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";
import { expect, waitFor, within } from "storybook/test";

import { Button } from "../../../src/ui/base-ui/button.js";
import {
  Dialog,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../../../src/ui/base-ui/dialog.js";
import {
  Popover,
  PopoverArrow,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "../../../src/ui/base-ui/popover.js";
import {
  PreviewCard,
  PreviewCardArrow,
  PreviewCardPopup,
  PreviewCardTrigger,
} from "../../../src/ui/base-ui/preview-card.js";
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "../../../src/ui/base-ui/tabs.js";
import { ThemeProvider } from "../../../src/ui/base-ui/theme-provider.js";
import { Toaster, toast } from "../../../src/ui/base-ui/toast.js";
import { Toggle } from "../../../src/ui/base-ui/toggle.js";
import guide from "./theme-provider.docs.md?raw";

const palette = paletteCss(
  createPalette({ brand: "#4477bb", gray: "#888888" }),
  { id: "workspace-blue" },
);

export default {
  title: "Components/Theme Provider",
  component: ThemeProvider,
  parameters: { docs: { description: { component: guide } } },
} satisfies Meta<typeof ThemeProvider>;

function Sample({ label }: { label: string }) {
  return (
    <Dialog>
      <DialogTrigger render={<Button />}>{label}</DialogTrigger>
      <DialogPopup aria-describedby={undefined} closeLabel="Close preview">
        <DialogTitle>{label}</DialogTitle>
      </DialogPopup>
    </Dialog>
  );
}

export const NestedRegions: StoryObj = {
  render: () => (
    <>
      <style>{palette}</style>
      <ThemeProvider
        appearance="dark"
        appTheme="design"
        density="compact"
        radius="large"
        corners="round"
        palette="workspace-blue"
        render={<section aria-label="Design tools" />}
        className="grid gap-3 rounded-lg bg-surface-canvas p-4 text-fg"
      >
        <Sample label="Design settings" />
        <ThemeProvider
          appTheme="slides"
          render={<section aria-label="Slides tools" />}
          className="grid gap-3 rounded-lg bg-surface-canvas p-4"
        >
          <Sample label="Slide settings" />
          <ThemeProvider
            appearance="light"
            render={<section aria-label="Light tools" />}
            className="rounded-lg bg-surface-canvas p-4"
          >
            <Sample label="Light preview" />
          </ThemeProvider>
          <ThemeProvider
            appTheme="slides"
            render={<section aria-label="Nested slides tools" />}
            className="rounded-lg bg-surface-canvas p-4"
          >
            <Sample label="Nested slide settings" />
          </ThemeProvider>
        </ThemeProvider>
        <ThemeProvider appTheme="baseline">
          <ThemeProvider appearance="light" className="grid gap-2">
            <Sample label="Baseline preview" />
            <ThemeProvider appTheme="design">
              <ThemeProvider palette="workspace-blue">
                <Sample label="Design preview" />
              </ThemeProvider>
            </ThemeProvider>
          </ThemeProvider>
        </ThemeProvider>
      </ThemeProvider>
      <div hidden>
        <ThemeProvider
          appearance="dark"
          appTheme="slides"
          density="compact"
          radius="large"
          corners="round"
          palette="workspace-blue"
        >
          <Button data-testid="dark-reference">Dark reference</Button>
        </ThemeProvider>
        <ThemeProvider
          appearance="light"
          appTheme="slides"
          density="compact"
          radius="large"
          corners="round"
          palette="workspace-blue"
        >
          <Button data-testid="light-reference">Light reference</Button>
        </ThemeProvider>
        {(["baseline", "design"] as const).map((theme) => (
          <ThemeProvider
            key={theme}
            appTheme={theme}
            appearance="light"
            palette="workspace-blue"
          >
            <Button data-testid={theme + "-reference"}>
              {theme} reference
            </Button>
          </ThemeProvider>
        ))}
      </div>
    </>
  ),
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement);
    const color = (el: Element, token: string) =>
      getComputedStyle(el).getPropertyValue(token).trim();
    const tokens = [
      "--surface-canvas",
      "--fg-default",
      "--brand-9",
      "--control-height-3",
      "--shape-control",
    ];
    for (const [name, mode] of [
      ["Slide settings", "dark"],
      ["Nested slide settings", "dark"],
      ["Light preview", "light"],
    ]) {
      const trigger = canvas.getByRole("button", { name });
      const reference = canvas.getByTestId(mode + "-reference");
      await expect(getComputedStyle(trigger).colorScheme).toBe(mode);
      for (const token of tokens) {
        await expect(color(reference, token)).not.toBe("");
        await expect(color(trigger, token)).toBe(color(reference, token));
      }
    }
    await expect(
      color(canvas.getByTestId("dark-reference"), "--surface-canvas"),
    ).not.toBe(
      color(canvas.getByTestId("light-reference"), "--surface-canvas"),
    );
    for (const [label, theme] of [
      ["Baseline preview", "baseline"],
      ["Design preview", "design"],
    ]) {
      const trigger = canvas.getByRole("button", { name: label });
      const reference = canvas.getByTestId(theme + "-reference");
      await userEvent.click(trigger);
      const popup = await canvas.findByRole("dialog", { name: label });
      for (const token of [
        "--surface-canvas",
        "--theme-background",
        "--success",
      ]) {
        await expect(color(trigger, token)).toBe(color(reference, token));
        await expect(color(popup, token)).toBe(color(reference, token));
      }
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(trigger).toHaveFocus());
    }
    const region = canvas.getByRole("region", { name: "Light tools" });
    const trigger = within(region).getByRole("button", {
      name: "Light preview",
    });
    await userEvent.click(trigger);
    const dialog = await within(region).findByRole("dialog", {
      name: "Light preview",
    });
    await expect(getComputedStyle(dialog).colorScheme).toBe("light");
    for (const token of tokens)
      await expect(color(dialog, token)).toBe(color(trigger, token));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

const sky = createPalette({ brand: "#2684ff" });
const coral = createPalette({ brand: "#e06453" });
const registeredPalettes = [
  paletteCss(sky, { id: "catalog-sky" }),
  paletteCss(coral, { id: "catalog-coral" }),
];

/** The nearest palette wins when an appearance changes inside another brand. */
export const NestedPalettes: StoryObj = {
  render: function NestedPalettesExample() {
    const [reversed, setReversed] = React.useState(false);
    return (
      <>
        <style>
          {(reversed
            ? [...registeredPalettes].reverse()
            : registeredPalettes
          ).join("\n")}
        </style>
        <Button onClick={() => setReversed(!reversed)}>
          Reverse stylesheet order
        </Button>
        <ThemeProvider
          appearance="dark"
          palette="catalog-sky"
          className="grid gap-3 p-4"
        >
          <Button>Sky dark</Button>
          <ThemeProvider appearance="light">
            <Button>Sky light</Button>
            <ThemeProvider palette="catalog-coral" className="grid gap-2">
              <Button>Coral light</Button>
              <ThemeProvider appearance="dark">
                <Button>Coral dark</Button>
              </ThemeProvider>
            </ThemeProvider>
          </ThemeProvider>
        </ThemeProvider>
      </>
    );
  },
  play: async ({ canvas, userEvent }) => {
    const checkColors = async () => {
      for (const [name, scale] of [
        ["Sky dark", sky.dark],
        ["Sky light", sky.light],
        ["Coral light", coral.light],
        ["Coral dark", coral.dark],
      ] as const) {
        const button = canvas.getByRole("button", { name });
        const browserIsP3 =
          matchMedia("(color-gamut: p3)").matches &&
          CSS.supports("color", "color(display-p3 1 1 1)");
        const expected =
          (browserIsP3 && scale.p3["--brand-9"]) || scale.srgb["--brand-9"];
        await expect(
          getComputedStyle(button).getPropertyValue("--brand-9").trim(),
        ).toBe(expected);
      }
    };
    await checkColors();
    await userEvent.click(
      canvas.getByRole("button", { name: "Reverse stylesheet order" }),
    );
    await checkColors();
  },
};

export const ExternalAppearance: StoryObj = {
  render: function ExternalAppearance() {
    const [mode, setMode] = React.useState<"dark" | "light">("dark");
    return (
      <ThemeProvider palette="catalog-sky" radius="none">
        <style>{registeredPalettes.join("\n")}</style>
        <div className={mode} data-palette="catalog-coral" data-radius="large">
          <ThemeProvider
            appTheme="design"
            className="grid gap-3 bg-surface-canvas p-4 text-fg"
          >
            <Button onClick={() => setMode(mode === "dark" ? "light" : "dark")}>
              Change document appearance
            </Button>
            <div className="light">
              <ThemeProvider appTheme="slides">
                <ThemeProvider appTheme="design">
                  <Button>Light preview</Button>
                </ThemeProvider>
              </ThemeProvider>
            </div>
          </ThemeProvider>
          <div hidden>
            <ThemeProvider
              appTheme="design"
              appearance="dark"
              palette="catalog-coral"
              radius="large"
            >
              <Button>Dark reference</Button>
            </ThemeProvider>
            <ThemeProvider
              appTheme="design"
              appearance="light"
              palette="catalog-coral"
              radius="large"
            >
              <Button>Light reference</Button>
            </ThemeProvider>
          </div>
        </div>
      </ThemeProvider>
    );
  },
  play: async ({ canvas, userEvent }) => {
    const colors = (element: Element) => {
      const style = getComputedStyle(element);
      return [
        "--theme-background",
        "--theme-foreground",
        "--gray-2",
        "--brand-9",
        "--shape-control",
      ].map((key) => style.getPropertyValue(key));
    };
    const toggle = canvas.getByRole("button", {
      name: "Change document appearance",
    });
    const preview = canvas.getByRole("button", { name: "Light preview" });
    const dark = colors(canvas.getByText("Dark reference"));
    const light = colors(canvas.getByText("Light reference"));
    await expect(dark).not.toEqual(light);
    await expect(getComputedStyle(toggle).colorScheme).toBe("dark");
    await expect(colors(toggle)).toEqual(dark);
    await expect(colors(preview)).toEqual(light);
    await userEvent.click(toggle);
    await expect(getComputedStyle(toggle).colorScheme).toBe("light");
    await expect(colors(toggle)).toEqual(light);
    await userEvent.click(toggle);
    await expect(getComputedStyle(toggle).colorScheme).toBe("dark");
    await expect(colors(toggle)).toEqual(dark);
    await expect(colors(preview)).toEqual(light);
  },
};

export const TokenOverrides: StoryObj = {
  render: function ControlSize() {
    const [tall, setTall] = React.useState(false);
    return (
      <ThemeProvider
        style={{
          "--control-height-3": tall ? "var(--control-height-4)" : undefined,
        }}
      >
        <Dialog>
          <DialogTrigger render={<Button />}>Control size</DialogTrigger>
          <DialogPopup aria-describedby={undefined}>
            <DialogTitle>Control size</DialogTitle>
            <Toggle pressed={tall} onPressedChange={setTall}>
              Taller controls
            </Toggle>
          </DialogPopup>
        </Dialog>
      </ThemeProvider>
    );
  },
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Control size" });
    const height = () => trigger.offsetHeight;
    const standard = height();
    await userEvent.click(trigger);
    const dialog = await canvas.findByRole("dialog", { name: "Control size" });
    const toggle = within(dialog).getByRole("button", {
      name: "Taller controls",
    });
    await userEvent.click(toggle);
    await expect(height()).toBeGreaterThan(standard);
    await expect(toggle.offsetHeight).toBe(height());
    await expect(toggle).toHaveFocus();
    await userEvent.keyboard(" ");
    await expect(height()).toBe(standard);
    await expect(toggle.offsetHeight).toBe(standard);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

function DirectionTabs({ label }: { label: string }) {
  return (
    <Tabs defaultValue="layers">
      <TabsList aria-label={label}>
        <TabsTab value="layers">Layers</TabsTab>
        <TabsTab value="assets">Assets</TabsTab>
        <TabsTab value="history">History</TabsTab>
      </TabsList>
      <TabsPanel value="layers">Layer list</TabsPanel>
      <TabsPanel value="assets">Asset library</TabsPanel>
      <TabsPanel value="history">Version history</TabsPanel>
    </Tabs>
  );
}

function AutomaticDirectionTabs() {
  const [arabic, setArabic] = React.useState(false);
  return (
    <ThemeProvider dir="auto">
      <Button lang={arabic ? "ar" : "en"} onClick={() => setArabic(!arabic)}>
        {arabic ? "تصميم" : "Design"}
      </Button>
      <DirectionTabs label="Automatic direction" />
    </ThemeProvider>
  );
}

export const ReadingDirection: StoryObj = {
  render: () => (
    <ThemeProvider dir="rtl" className="grid gap-4">
      <ThemeProvider density="compact">
        <DirectionTabs label="Workspace" />
      </ThemeProvider>
      <AutomaticDirectionTabs />
      <ThemeProvider dir="ltr">
        <DirectionTabs label="Embedded preview" />
      </ThemeProvider>
      <ThemeProvider render={<section dir="ltr" />}>
        <ThemeProvider density="compact">
          <DirectionTabs label="Composed region" />
        </ThemeProvider>
      </ThemeProvider>
      <ThemeProvider
        dir="ltr"
        render={(props) => <section {...props} dir="rtl" />}
      >
        <DirectionTabs label="Rendered region" />
      </ThemeProvider>
    </ThemeProvider>
  ),
  play: async ({ canvas, userEvent }) => {
    for (const [name, direction, next, previous] of [
      ["Workspace", "rtl", "{ArrowLeft}", "{ArrowRight}"],
      ["Automatic direction", "ltr", "{ArrowRight}", "{ArrowLeft}"],
      ["Embedded preview", "ltr", "{ArrowRight}", "{ArrowLeft}"],
      ["Composed region", "ltr", "{ArrowRight}", "{ArrowLeft}"],
      ["Rendered region", "rtl", "{ArrowLeft}", "{ArrowRight}"],
    ]) {
      const list = canvas.getByRole("tablist", { name });
      const tabs = within(list);
      const first = tabs.getByRole("tab", { name: "Layers" });
      const second = tabs.getByRole("tab", { name: "Assets" });
      await expect(getComputedStyle(list).direction).toBe(direction);
      await userEvent.click(first);
      await userEvent.keyboard(next);
      await expect(second).toHaveFocus();
      await userEvent.keyboard(previous);
      await expect(first).toHaveFocus();
    }
    const automatic = canvas.getByRole("tablist", {
      name: "Automatic direction",
    });
    await userEvent.click(canvas.getByRole("button", { name: "Design" }));
    await expect(getComputedStyle(automatic).direction).toBe("rtl");
    await userEvent.click(
      within(automatic).getByRole("tab", { name: "Layers" }),
    );
    await userEvent.keyboard("{ArrowLeft}");
    await expect(
      within(automatic).getByRole("tab", { name: "Assets" }),
    ).toHaveFocus();
  },
};

export const InitialDialog: StoryObj = {
  render: function InitialDialogExample() {
    const [outer, setOuter] = React.useState<HTMLDivElement | null>(null);
    return (
      <ThemeProvider
        appearance="light"
        ref={setOuter}
        data-testid="outer-theme"
      >
        <ThemeProvider appearance="dark" data-testid="inner-theme">
          <Dialog defaultOpen>
            <DialogPopup
              aria-describedby={undefined}
              closeLabel="Close settings"
            >
              <DialogTitle>Workspace settings</DialogTitle>
            </DialogPopup>
          </Dialog>
          <Dialog>
            <DialogTrigger render={<Button />}>
              Open light preview
            </DialogTrigger>
            <DialogPopup container={outer} aria-describedby={undefined}>
              <DialogTitle>Light preview</DialogTitle>
            </DialogPopup>
          </Dialog>
        </ThemeProvider>
      </ThemeProvider>
    );
  },
  play: async ({ canvas, userEvent }) => {
    const inner = canvas.getByTestId("inner-theme");
    const outer = canvas.getByTestId("outer-theme");
    const settings = await within(inner).findByRole("dialog", {
      name: "Workspace settings",
    });
    await expect(getComputedStyle(settings).colorScheme).toBe("dark");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(settings).not.toBeInTheDocument());
    const trigger = canvas.getByRole("button", { name: "Open light preview" });
    await userEvent.click(trigger);
    const preview = await within(outer).findByRole("dialog", {
      name: "Light preview",
    });
    await expect(inner).not.toContainElement(preview);
    await expect(getComputedStyle(preview).colorScheme).toBe("light");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

export const LogicalPopupSides: StoryObj = {
  render: () => (
    <ThemeProvider appearance="light" dir="ltr">
      {(["ltr", "rtl"] as const).map((dir) => (
        <ThemeProvider
          key={dir}
          dir={dir}
          appearance={dir === "rtl" ? "dark" : "light"}
          render={<section aria-label={dir.toUpperCase()} />}
          className="grid justify-items-center gap-6 bg-surface-canvas p-6 text-fg"
        >
          <Popover defaultOpen>
            <PopoverTrigger render={<Button />}>Details</PopoverTrigger>
            <PopoverPopup side="inline-start" style={{ width: "6rem" }}>
              <PopoverArrow data-testid="start-arrow" />
              <PopoverTitle>Details</PopoverTitle>
            </PopoverPopup>
          </Popover>
          <PreviewCard defaultOpen>
            <PreviewCardTrigger href="#profile">Profile</PreviewCardTrigger>
            <PreviewCardPopup side="inline-end" style={{ width: "6rem" }}>
              <PreviewCardArrow data-testid="end-arrow" />
              Profile
            </PreviewCardPopup>
          </PreviewCard>
        </ThemeProvider>
      ))}
    </ThemeProvider>
  ),
  play: async ({ canvas }) => {
    for (const dir of ["ltr", "rtl"]) {
      const region = within(
        canvas.getByRole("region", { name: dir.toUpperCase() }),
      );
      for (const side of ["start", "end"]) {
        const arrow = await region.findByTestId(side + "-arrow");
        await waitFor(() =>
          expect(arrow).toHaveAttribute("data-side", "inline-" + side),
        );
        const style = getComputedStyle(arrow);
        const facesRight = (dir === "ltr") === (side === "start");
        await expect(
          parseFloat(facesRight ? style.right : style.left),
        ).toBeLessThan(0);
        await expect(
          facesRight ? style.borderLeftWidth : style.borderRightWidth,
        ).toBe("0px");
      }
    }
  },
};

export const CanvasNotifications: StoryObj = {
  render: function CanvasNotifications() {
    const canvas = React.useRef<HTMLDivElement>(null);
    return (
      <ThemeProvider appearance="light" className="bg-surface-canvas p-4">
        <ThemeProvider
          ref={canvas}
          appearance="dark"
          density="compact"
          className="min-h-64 rounded-lg bg-surface-canvas p-4"
        >
          <Toaster
            container={canvas}
            regionLabel="Canvas notifications"
            closeLabel="Dismiss"
          >
            <Button onClick={() => toast.add({ title: "Frame exported" })}>
              Export frame
            </Button>
          </Toaster>
        </ThemeProvider>
      </ThemeProvider>
    );
  },
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Export frame" });
    await userEvent.click(trigger);
    const title = await canvas.findByText("Frame exported");
    const portal = title.closest(".toast-portal");
    await expect(portal).toHaveAttribute("data-anchored");
    await expect(portal?.parentElement).toBe(trigger.closest("[data-density]"));
    await expect(getComputedStyle(title).colorScheme).toBe("dark");
    await userEvent.keyboard("{F6}");
    await userEvent.click(
      await canvas.findByRole("button", { name: "Dismiss" }),
    );
    await waitFor(() => expect(title).not.toBeInTheDocument());
  },
};

export const SystemAppearance: StoryObj = {
  render: () => (
    <ThemeProvider
      appearance="system"
      appTheme="design"
      render={<section aria-label="System appearance" />}
      className="grid gap-3 rounded-lg bg-surface-canvas p-4 text-fg"
    >
      <Sample label="Workspace settings" />
      <ThemeProvider
        appearance="light"
        className="rounded-lg bg-surface-canvas p-4 text-fg"
      >
        <Sample label="Light preview" />
      </ThemeProvider>
    </ThemeProvider>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const win = canvasElement.ownerDocument.defaultView;
    if (!win) throw new Error("Missing preview window");
    const scheme = win.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
    for (const [label, expected] of [
      ["Workspace settings", scheme],
      ["Light preview", "light"],
    ]) {
      const trigger = canvas.getByRole("button", { name: label });
      await userEvent.click(trigger);
      const dialog = await canvas.findByRole("dialog", { name: label });
      await expect(getComputedStyle(dialog).colorScheme).toBe(expected);
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(trigger).toHaveFocus());
    }
  },
};
