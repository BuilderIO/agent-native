import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconArrowBackUp, IconFrame } from "@tabler/icons-react";
import { useRef } from "react";
import { expect, fireEvent, waitFor, within } from "storybook/test";

import { IconButton } from "../../../src/ui/base-ui/button.js";
import {
  Inspector,
  InspectorHeader,
} from "../../../src/ui/base-ui/inspector.js";
import {
  type Paint,
  PaintEditor,
  type PaintToken,
  paintBackground,
} from "../../../src/ui/base-ui/paint-editor.js";
import { ThemeProvider } from "../../../src/ui/base-ui/theme-provider.js";
import guide from "./paint-editor.docs.md?raw";
import { usePaintHistory } from "./use-paint-history.js";

const tokens: PaintToken[] = [
  { id: "iris", label: "Iris", value: "var(--brand-10)" },
  { id: "cloud", label: "Cloud", value: "var(--info-4)" },
];
const initial: readonly Paint[] = [
  {
    id: "veil",
    kind: "linear",
    angle: 125,
    opacity: 85,
    visible: true,
    stops: [
      { id: "start", offset: 0, color: { value: "transparent" } },
      {
        id: "middle",
        offset: 55,
        color: { token: "iris", value: "rebeccapurple" },
      },
      { id: "end", offset: 100, color: { value: "midnightblue" } },
    ],
  },
  {
    id: "paper",
    kind: "solid",
    opacity: 100,
    visible: true,
    color: { token: "cloud", value: "aliceblue" },
  },
];

function FillInspector({ onCancel = true }: { onCancel?: boolean }) {
  const { paints, edit, cancel, undo, canUndo } = usePaintHistory(initial);
  const portal = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={portal}
      className="grid bg-surface-sunken md:grid-cols-[minmax(0,1fr)_280px]"
    >
      <div className="grid min-h-64 place-items-center p-8">
        <div className="w-full max-w-80">
          <span className="text-xs text-fg-muted">Cover</span>
          <div
            role="img"
            aria-label="Cover fill preview"
            className="relative aspect-[3/2] outline outline-1 outline-[var(--line-focus)]"
            style={{
              backgroundImage: paintBackground(paints, tokens),
              forcedColorAdjust: "none",
            }}
          >
            {[
              "top-0 left-0",
              "top-0 right-0",
              "bottom-0 left-0",
              "bottom-0 right-0",
            ].map((corner) => (
              <i
                key={corner}
                aria-hidden
                className={
                  "absolute size-1 border border-[var(--line-focus)] bg-surface-raised " +
                  corner
                }
              />
            ))}
          </div>
        </div>
      </div>
      <Inspector
        aria-label="Cover properties"
        className="border-s border-line bg-surface-nav"
      >
        <InspectorHeader>
          <h2 className="type-label flex items-center gap-2">
            <IconFrame size={14} aria-hidden />
            Cover
          </h2>
          <IconButton
            type="button"
            aria-label="Undo paint edit"
            title="Undo paint edit"
            disabled={!canUndo}
            variant="ghost"
            color="gray"
            onClick={undo}
          >
            <IconArrowBackUp />
          </IconButton>
        </InspectorHeader>
        <PaintEditor
          value={paints}
          tokens={tokens}
          container={portal}
          onValueChange={edit}
          onCancelPreview={onCancel ? cancel : undefined}
        />
      </Inspector>
    </div>
  );
}

export default {
  title: "Patterns/Paint Editor",
  component: PaintEditor,
  parameters: {
    docs: { description: { component: guide } },
  },
} satisfies Meta;

export const Fill: StoryObj = { render: () => <FillInspector /> };

export const EditGradient: StoryObj = {
  render: () => <FillInspector />,
  play: async ({ canvas, userEvent }) => {
    const page = within(document.body);
    const preview = canvas.getByRole("img", { name: "Cover fill preview" });
    const initialImage = preview.style.backgroundImage;
    await userEvent.click(
      canvas.getByRole("button", { name: "Edit Linear gradient 1" }),
    );
    const middle = await page.findByRole("slider", { name: "Stop 2" });
    middle.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(middle).toHaveAttribute("aria-valuenow", "56");
    await expect(preview.style.backgroundImage).toContain("56%");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(
      canvas.getByRole("button", { name: "Undo paint edit" }),
    );
    await expect(preview.style.backgroundImage).toBe(initialImage);
    await userEvent.click(
      canvas.getByRole("button", { name: "Edit Linear gradient 1" }),
    );
    await userEvent.click(
      await page.findByRole("button", { name: "Add stop" }),
    );
    await expect(page.getAllByRole("slider")).toHaveLength(4);
    await userEvent.click(page.getByRole("button", { name: "Remove stop" }));
    await expect(page.getAllByRole("slider")).toHaveLength(3);
    await expect(preview.style.backgroundImage).toBe(initialImage);
  },
};

export const OrderAndBind: StoryObj = {
  render: () => <FillInspector />,
  play: async ({ canvas, userEvent }) => {
    const page = within(document.body);
    const preview = canvas.getByRole("img", { name: "Cover fill preview" });
    const initialImage = preview.style.backgroundImage;
    await userEvent.click(canvas.getByRole("button", { name: "Add fill" }));
    await userEvent.click(await page.findByRole("menuitem", { name: "Solid" }));
    const fills = canvas.getByRole("list", { name: "Fill" });
    await expect(within(fills).getAllByRole("listitem")).toHaveLength(3);
    await userEvent.click(canvas.getByRole("button", { name: "Edit Solid 1" }));
    await userEvent.click(
      await page.findByRole("combobox", { name: "Color token" }),
    );
    await userEvent.click(await page.findByRole("option", { name: /^Iris/ }));
    await expect(preview.style.backgroundImage).toMatch(
      /^linear-gradient\(var\(--brand-10\)/,
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(page.queryByRole("combobox", { name: "Color token" })).toBeNull(),
    );
    const actions = canvas.getByRole("button", {
      name: "Paint actions Solid 1",
    });
    actions.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.click(
      await page.findByRole("menuitem", { name: "Move down" }),
    );
    await expect(
      within(fills).getAllByRole("listitem")[1],
    ).toHaveAccessibleName("Solid 2");
    await expect(preview.style.backgroundImage).not.toMatch(
      /^linear-gradient\(var\(--brand-10\)/,
    );
    await userEvent.click(canvas.getByRole("button", { name: "Hide Solid 2" }));
    await expect(preview.style.backgroundImage).toBe(initialImage);
    const undo = canvas.getByRole("button", { name: "Undo paint edit" });
    for (let i = 0; i < 4; i++) await userEvent.click(undo);
    await expect(within(fills).getAllByRole("listitem")).toHaveLength(2);
    await expect(preview.style.backgroundImage).toBe(initialImage);
    await expect(undo).toBeDisabled();
  },
};

export const DragStop: StoryObj = {
  render: () => <FillInspector />,
  play: async ({ canvas, userEvent }) => {
    const page = within(document.body);
    const preview = canvas.getByRole("img", { name: "Cover fill preview" });
    const original = preview.style.backgroundImage;
    await userEvent.click(
      canvas.getByRole("button", { name: "Edit Linear gradient 1" }),
    );
    const middle = await page.findByRole("slider", { name: "Stop 2" });
    const thumb = middle.closest<HTMLElement>(".slider-thumb");
    const track = thumb?.closest<HTMLElement>(".slider-track");
    if (!thumb || !track)
      throw new Error("Expected a gradient thumb inside the slider track.");
    const box = track.getBoundingClientRect();
    const y = box.top + box.height / 2;
    const x = thumb.getBoundingClientRect().x + thumb.offsetWidth / 2;
    await userEvent.pointer([
      { keys: "[MouseLeft>]", target: thumb, coords: { x, y } },
      { target: track, coords: { x: box.left + box.width * 0.64, y } },
      { target: track, coords: { x: box.left + box.width * 0.76, y } },
      { keys: "[/MouseLeft]" },
    ]);
    await expect(Number(middle.getAttribute("aria-valuenow"))).toBeGreaterThan(
      64,
    );
    await expect(preview.style.backgroundImage).not.toBe(original);
    await userEvent.keyboard("{Escape}");
    const undo = canvas.getByRole("button", { name: "Undo paint edit" });
    await userEvent.click(undo);
    await expect(preview.style.backgroundImage).toBe(original);
    await expect(undo).toBeDisabled();
  },
};

export const CancelNumericEdit: StoryObj = {
  render: () => <FillInspector />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body);
    const preview = canvas.getByRole("img", { name: "Cover fill preview" });
    const original = preview.style.backgroundImage;
    const trigger = canvas.getByRole("button", {
      name: "Edit Linear gradient 1",
    });
    await userEvent.click(trigger);
    const middle = await page.findByRole("slider", { name: "Stop 2" });
    page.getByRole("slider", { name: "Stop 1" }).focus();
    await userEvent.tab();
    await expect(middle).toHaveFocus();
    for (const [name, before, changed] of [
      ["Stop position", "55", "32"],
      ["Angle", "125°", "40"],
      ["Opacity", "85", "62"],
    ]) {
      const input = page.getByRole("textbox", { name });
      await expect(input).toHaveValue(before);
      await userEvent.clear(input);
      await userEvent.type(input, changed);
      await expect(preview.style.backgroundImage).not.toBe(original);
      await userEvent.keyboard("{Escape}");
      const restored = page.getByRole("textbox", { name });
      await expect(restored).toHaveFocus();
      await expect(restored).toHaveValue(before);
      await expect(preview.style.backgroundImage).toBe(original);
      await expect(
        canvas.getByRole("button", { name: "Undo paint edit" }),
      ).toBeDisabled();
    }
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

export const RightToLeftStops: StoryObj = {
  render: () => (
    <ThemeProvider dir="rtl">
      <FillInspector />
    </ThemeProvider>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      canvas.getByRole("button", { name: "Edit Linear gradient 1" }),
    );
    const first = await page.findByRole("slider", { name: "Stop 1" });
    const middle = page.getByRole("slider", { name: "Stop 2" });
    const track = middle.closest<HTMLElement>(".paint-editor-gradient");
    if (!track) throw new Error("Missing gradient track.");
    await expect(getComputedStyle(track).backgroundImage).toMatch(
      /to left|270deg/,
    );
    await expect(first.getBoundingClientRect().x).toBeGreaterThan(
      middle.getBoundingClientRect().x,
    );
    middle.focus();
    await userEvent.keyboard("{Home}");
    await expect(middle).toHaveAttribute("aria-valuenow", "0");
    await userEvent.keyboard("{ArrowLeft}");
    await expect(first).toHaveAttribute("aria-valuenow", "0");
    await expect(middle).toHaveFocus();
    await expect(middle).toHaveAttribute("aria-valuenow", "1");
    await expect(
      page.getByRole("textbox", { name: "Stop position" }),
    ).toHaveValue("1");
    await expect(
      page.getByRole("combobox", { name: "Color token" }),
    ).toHaveTextContent("Iris");
  },
};

export const InterruptedDrag: StoryObj = {
  render: () => <FillInspector onCancel={false} />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body);
    const preview = canvas.getByRole("img", { name: "Cover fill preview" });
    const original = preview.style.backgroundImage;
    await userEvent.click(
      canvas.getByRole("button", { name: "Edit Linear gradient 1" }),
    );
    const stop = await page.findByRole("slider", { name: "Stop 2" });
    const thumb = stop.closest<HTMLElement>(".slider-thumb");
    const track = thumb?.closest<HTMLElement>(".slider-track");
    if (!thumb || !track) throw new Error("Missing gradient track.");
    const box = track.getBoundingClientRect();
    const y = box.y + box.height / 2;
    await userEvent.pointer([
      {
        keys: "[MouseLeft>]",
        target: thumb,
        coords: {
          x: thumb.getBoundingClientRect().x + thumb.offsetWidth / 2,
          y,
        },
      },
      { target: track, coords: { x: box.x + box.width * 0.8, y } },
    ]);
    await expect(preview.style.backgroundImage).not.toBe(original);
    await fireEvent.pointerCancel(track, {
      pointerId: 1,
      pointerType: "mouse",
      clientX: box.x + box.width * 0.8,
      clientY: y,
    });
    await userEvent.pointer({ keys: "[/MouseLeft]" });
    await waitFor(() => expect(preview.style.backgroundImage).toBe(original));
    await expect(stop).toHaveAttribute("aria-valuenow", "55");
    await expect(
      canvas.getByRole("button", { name: "Undo paint edit" }),
    ).toBeDisabled();
  },
};

export const DetachColor: StoryObj = {
  render: () => <FillInspector />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole("button", { name: "Edit Solid 2" }));
    const picker = await page.findByRole("combobox", { name: "Color token" });
    const swatch = picker.querySelector(".property-token-swatch");
    if (!swatch) throw new Error("Expected the bound color preview");
    const color = getComputedStyle(swatch).backgroundColor;
    await userEvent.click(picker);
    await userEvent.click(await page.findByRole("option", { name: "Detach" }));
    await expect(page.getByRole("textbox", { name: "Color" })).toHaveValue(
      color,
    );
    await userEvent.keyboard("{Escape}");
    await userEvent.click(
      canvas.getByRole("button", { name: "Undo paint edit" }),
    );
    await expect(
      canvas.getByRole("button", { name: "Edit Solid 2" }),
    ).toHaveTextContent("Cloud");
  },
};
