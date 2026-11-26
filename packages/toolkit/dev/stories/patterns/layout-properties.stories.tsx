import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fireEvent, waitFor } from "storybook/test";

import { Button } from "../../../src/ui/base-ui/button.js";
import {
  Inspector,
  InspectorHeader,
  InspectorSection,
  InspectorSectionHeader,
  InspectorContent,
} from "../../../src/ui/base-ui/inspector.js";
import {
  canLockAspectRatio,
  LayoutDimensions,
  PropertyNumber,
  resizeLayout,
  type LayoutDimensionsValue,
  type LayoutResize,
  type PropertyEdit,
} from "../../../src/ui/base-ui/layout-properties.js";
import guide from "./layout-properties.docs.md?raw";

interface Frame extends LayoutDimensionsValue {
  id: string;
  paint: string;
}
const original: Frame[] = [
  {
    id: "Title",
    width: 160,
    height: 40,
    aspectRatio: 4,
    paint: "var(--info-4)",
  },
  {
    id: "Subtitle",
    width: 120,
    height: 48,
    aspectRatio: null,
    paint: "var(--warning-4)",
  },
];
function common<T>(values: readonly T[], mixed: T): T {
  return values.every((v) => v === values[0]) ? values[0] : mixed;
}

function MixedLayout() {
  const [frames, setFrames] = useState(original);
  const [preview, setPreview] = useState<LayoutResize | null>(null);
  const [history, setHistory] = useState<Frame[][]>([]);
  const shown = preview ? frames.map((f) => resizeLayout(f, preview)) : frames;
  function save(next: Frame[]) {
    setHistory((previous) => [...previous, frames]);
    setFrames(next);
  }
  function edit(e: PropertyEdit<LayoutResize>) {
    if (e.phase === "preview") {
      setPreview(e.value);
      return;
    }
    setPreview(null);
    if (e.phase === "commit") {
      const next = frames.map((f) => resizeLayout(f, e.value));
      if (
        next.some(
          (f, i) =>
            f.width !== frames[i].width || f.height !== frames[i].height,
        )
      )
        save(next);
    }
  }
  return (
    <div className="grid gap-4 bg-surface-sunken p-4 md:grid-cols-[minmax(0,1fr)_280px]">
      <div className="flex min-w-0 flex-col items-start gap-3 overflow-auto p-4">
        {shown.map((f) => (
          <div key={f.id}>
            <p className="mb-1 text-xs">{f.id}</p>
            <div
              role="img"
              aria-label={f.id + " frame"}
              style={{ width: f.width, height: f.height, background: f.paint }}
              className="outline outline-1 outline-[var(--line-focus)]"
            />
          </div>
        ))}
      </div>
      <Inspector aria-label="Selection properties">
        <InspectorHeader>
          <h2 className="type-label">2 frames</h2>
          <Button
            variant="ghost"
            disabled={!history.length}
            onClick={() => {
              const last = history.at(-1);
              if (last) {
                setPreview(null);
                setFrames(last);
                setHistory(history.slice(0, -1));
              }
            }}
          >
            Undo
          </Button>
        </InspectorHeader>
        <InspectorSection>
          <InspectorSectionHeader>
            <h3 className="type-label">Layout</h3>
          </InspectorSectionHeader>
          <InspectorContent>
            <LayoutDimensions
              width={common(
                shown.map((f) => f.width),
                null,
              )}
              height={common(
                shown.map((f) => f.height),
                null,
              )}
              locked={common<boolean | "mixed">(
                frames.map((f) => f.aspectRatio !== null),
                "mixed",
              )}
              lockDisabled={shown.some(
                (f) =>
                  f.aspectRatio === null &&
                  !canLockAspectRatio(f.width, f.height),
              )}
              limits={{ min: 1 }}
              onEdit={edit}
              onLockChange={(lock) =>
                save(
                  frames.map((f) => ({
                    ...f,
                    aspectRatio: lock
                      ? (f.aspectRatio ?? f.width / f.height)
                      : null,
                  })),
                )
              }
            />
          </InspectorContent>
        </InspectorSection>
      </Inspector>
    </div>
  );
}
export default {
  title: "Patterns/Layout Properties",
  component: LayoutDimensions,
  parameters: {
    docs: { description: { component: guide } },
  },
} satisfies Meta;
export const MixedSelection: StoryObj = { render: () => <MixedLayout /> };
const mouse = {
  pointerId: 1,
  pointerType: "mouse",
  isPrimary: true,
  clientY: 20,
};
function pressScrub(handle: Element, x: number) {
  return fireEvent.pointerDown(handle, {
    ...mouse,
    button: 0,
    buttons: 1,
    clientX: x,
  });
}
function moveScrub(handle: Element, x: number, movementX: number) {
  return fireEvent.pointerMove(handle, {
    ...mouse,
    button: -1,
    buttons: 1,
    clientX: x,
    movementX,
  });
}
function releaseScrub(handle: Element, x: number) {
  return fireEvent.pointerUp(handle, {
    ...mouse,
    button: 0,
    buttons: 0,
    clientX: x,
  });
}

export const EditAndUndo: StoryObj = {
  render: () => <MixedLayout />,
  play: async ({ canvas, userEvent }) => {
    const width = canvas.getByRole("textbox", { name: "Width" }),
      height = canvas.getByRole("textbox", { name: "Height" });
    const title = canvas.getByRole("img", { name: "Title frame" }),
      subtitle = canvas.getByRole("img", { name: "Subtitle frame" });
    const undo = canvas.getByRole("button", { name: "Undo" });
    await expect(width).toHaveAttribute("placeholder", "Mixed");
    await expect(width).toHaveValue("");
    await userEvent.type(width, "240");
    await expect(title).toHaveStyle({ width: "240px", height: "60px" });
    await expect(subtitle).toHaveStyle({ width: "240px", height: "48px" });
    await expect(undo).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await expect(title).toHaveStyle({ width: "160px", height: "40px" });
    await expect(subtitle).toHaveStyle({ width: "120px", height: "48px" });
    await userEvent.type(canvas.getByRole("textbox", { name: "Width" }), "200");
    await userEvent.keyboard("{Enter}");
    await expect(title).toHaveStyle({ width: "200px", height: "50px" });
    await expect(subtitle).toHaveStyle({ width: "200px", height: "48px" });
    await expect(height).toHaveValue("");
    const scrub = canvas.getByText("W", { selector: "label" });
    await pressScrub(scrub, 100);
    await moveScrub(scrub, 112, 12);
    await moveScrub(scrub, 120, 8);
    await releaseScrub(scrub, 120);
    await expect(title).toHaveStyle({ width: "220px", height: "55px" });
    await userEvent.click(undo);
    await expect(title).toHaveStyle({ width: "200px", height: "50px" });
    await userEvent.click(undo);
    await expect(undo).toBeDisabled();
    await expect(title).toHaveStyle({ width: "160px", height: "40px" });
    await expect(subtitle).toHaveStyle({ width: "120px", height: "48px" });
  },
};

export const InterruptedScrub: StoryObj = {
  render: () => (
    <fieldset>
      <MixedLayout />
    </fieldset>
  ),
  play: async ({ canvas, userEvent }) => {
    const title = canvas.getByRole("img", { name: "Title frame" });
    const undo = canvas.getByRole("button", { name: "Undo" });
    for (const interruption of [
      "pointercancel",
      "second-pointer",
      "blur",
      "fieldset",
    ]) {
      const label = canvas.getByText("W", { selector: "label" });
      const fieldset = label.closest("fieldset");
      if (!fieldset) throw new Error("Missing layout fieldset");
      await pressScrub(label, 50);
      await moveScrub(label, 70, 20);
      await expect(title).not.toHaveStyle({ width: "160px" });
      if (interruption === "pointercancel")
        await fireEvent.pointerCancel(label, { pointerId: 1 });
      else if (interruption === "second-pointer") {
        await fireEvent.pointerDown(label, {
          pointerId: 9,
          pointerType: "touch",
          isPrimary: false,
          button: 0,
        });
        await fireEvent.pointerUp(label, {
          pointerId: 9,
          pointerType: "touch",
        });
      } else if (interruption === "fieldset") {
        fieldset.disabled = true;
      } else window.dispatchEvent(new Event("blur"));
      await waitFor(() =>
        expect(title).toHaveStyle({ width: "160px", height: "40px" }),
      );
      const handle = canvas.getByText("W", { selector: "label" });
      await moveScrub(handle, 80, 10);
      await releaseScrub(handle, 80);
      await expect(canvas.getByRole("textbox", { name: "Width" })).toHaveValue(
        "",
      );
      fieldset.disabled = false;
      await expect(undo).toBeDisabled();
    }
    await userEvent.type(canvas.getByRole("textbox", { name: "Width" }), "180");
    await userEvent.keyboard("{Enter}");
    await expect(title).toHaveStyle({ width: "180px", height: "45px" });
    await userEvent.click(undo);
    await expect(undo).toBeDisabled();
  },
};

function ValidatedDimension() {
  const [width, setWidth] = useState(160);
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? width;
  return (
    <div className="max-w-72">
      <PropertyNumber
        label="Width"
        prefix="W"
        value={value}
        error={value > 320 ? "Width exceeds the 320 px parent frame." : null}
        onEdit={(e) => {
          if (e.phase === "cancel") {
            setDraft(null);
            return;
          }
          if (e.phase === "preview" || e.value > 320) {
            setDraft(e.value);
            return;
          }
          setWidth(e.value);
          setDraft(null);
        }}
      />
    </div>
  );
}
export const Validation: StoryObj = { render: () => <ValidatedDimension /> };
export const CorrectValidation: StoryObj = {
  render: () => <ValidatedDimension />,
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole("textbox", { name: "Width" });
    const liveRegion = canvas.getByRole("alert");
    await expect(liveRegion).toBeEmptyDOMElement();
    await userEvent.clear(input);
    await userEvent.type(input, "400");
    await expect(canvas.getByRole("alert")).toBe(liveRegion);
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription(
      "Width exceeds the 320 px parent frame.",
    );
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Width exceeds the 320 px parent frame.",
    );
    await userEvent.clear(input);
    await userEvent.type(input, "200");
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByRole("alert")).toBe(liveRegion);
    await expect(liveRegion).toBeEmptyDOMElement();
    await expect(canvas.getByRole("textbox", { name: "Width" })).toHaveValue(
      "200",
    );
    await expect(
      canvas.getByRole("textbox", { name: "Width" }),
    ).not.toHaveAttribute("aria-invalid");
  },
};

function LocalizedPosition() {
  const [position, setPosition] = useState(-12.5);
  const [preview, setPreview] = useState<number | null>(null);
  return (
    <div className="max-w-72">
      <PropertyNumber
        label="Horizontal position"
        prefix="X"
        locale="de-DE"
        step={0.25}
        value={preview ?? position}
        onEdit={(edit) => {
          if (edit.phase === "preview") setPreview(edit.value);
          else {
            if (edit.phase === "commit") setPosition(edit.value);
            setPreview(null);
          }
        }}
      />
      <output aria-label="Committed position">{position}</output>
    </div>
  );
}

export const LocalizedPositionField: StoryObj = {
  render: () => <LocalizedPosition />,
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole("textbox", { name: "Horizontal position" });
    const committed = canvas.getByLabelText("Committed position");
    await expect(input).toHaveValue("-12,5");
    await userEvent.clear(input);
    await userEvent.type(input, "-8,75");
    await expect(committed).toHaveTextContent("-12.5");
    await userEvent.keyboard("{Enter}");
    await expect(input).toHaveValue("-8,75");
    await expect(committed).toHaveTextContent("-8.75");
    await userEvent.click(input);
    await userEvent.keyboard("{ArrowUp}");
    await expect(input).toHaveValue("-8,5");
    await expect(committed).toHaveTextContent("-8.5");
  },
};
