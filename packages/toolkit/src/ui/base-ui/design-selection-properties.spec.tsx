// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import {
  DesignSelectionProperties,
  type DesignLayerGeometry,
  type DesignSelectionPropertiesProps,
} from "./design-property-inspector.js";

afterEach(cleanup);

const first: DesignLayerGeometry = {
  x: -20,
  y: 0,
  width: 10,
  height: 8,
  aspectRatio: null,
  rotation: 0,
  opacity: 100,
  radius: 0,
  flipX: false,
  flipY: false,
  stroke: 0,
  shadow: 0,
  state: "Default",
  responsive: null,
  blend: "normal",
  auto: null,
  paints: null,
};
function mountSelection<Geometry extends DesignLayerGeometry>(
  layers: DesignSelectionPropertiesProps["layers"],
  current: readonly Geometry[],
  lockedLayerIds?: ReadonlySet<string>,
  slots: Pick<
    DesignSelectionPropertiesProps<Geometry>,
    "sections" | "renderPositionAction" | "sizeLimits"
  > = {},
) {
  const apply = vi.fn<DesignSelectionPropertiesProps<Geometry>["apply"]>();
  render(
    <DesignSelectionProperties
      layers={layers}
      current={current}
      lockedLayerIds={lockedLayerIds}
      {...slots}
      title="Selected rectangles"
      visible
      setVisible={vi.fn()}
      apply={apply}
      edit={vi.fn()}
      canUndo={false}
      canRedo={false}
      undo={vi.fn()}
      redo={vi.fn()}
      paints={[]}
      firstFill={[]}
      tokens={[]}
      automatic={{
        mode: "row",
        alignment: { align: "start", justify: "start" },
        grid: { columns: 1, rows: "auto" },
        gap: 0,
        paddingX: 0,
        paddingY: 0,
        wrap: false,
        clip: false,
      }}
    />,
  );
  return apply;
}

it("exposes mixed flip states and applies the next value to every selected layer", () => {
  const original = { ...first, componentId: "wordmark" };
  const other = { ...first, componentId: "symbol", flipX: true };
  const layers = ["a", "b"].map((id) => ({ id, name: id, kind: "frame" }));
  const apply = mountSelection(layers, [original, other]);
  const horizontal = screen.getByRole("button", { name: "Flip horizontal" });
  expect(horizontal.getAttribute("aria-pressed")).toBe("mixed");
  expect(
    screen
      .getByRole("button", { name: "Flip vertical" })
      .getAttribute("aria-pressed"),
  ).toBe("false");
  fireEvent.click(horizontal);
  const [flip] = apply.mock.calls[0];
  const updated = [original, other].map(flip);
  expect(updated.map((layer) => layer.flipX)).toEqual([true, true]);
  expect(updated.map((layer) => layer.componentId)).toEqual([
    "wordmark",
    "symbol",
  ]);
});

it("uses only editable layers for flip state and alignment eligibility", () => {
  const layers = ["locked", "editable"].map((id) => ({
    id,
    parentId: "page",
    name: id,
    kind: "frame",
  }));
  mountSelection(
    layers,
    [first, { ...first, flipX: true }],
    new Set(["locked"]),
  );
  expect(
    screen
      .getByRole("button", { name: "Flip horizontal" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.getByRole("img", { name: "1 locked" })).toBeDefined();
  expect(
    screen.getByRole("button", { name: "Align left" }).matches(":disabled"),
  ).toBe(true);
});

it("updates a shared breakpoint without copying another layer's padding", async () => {
  const layers = ["a", "b"].map((id) => ({ id, name: id, kind: "frame" }));
  const geometries = [8, 32].map((padding) => ({
    ...first,
    responsive: { maxWidth: 640, padding },
  }));
  const apply = mountSelection(layers, geometries);
  const breakpoint = screen.getByRole("combobox", { name: "Breakpoint" });
  expect(breakpoint.textContent).toContain("Below sm · 640");
  expect(
    screen.getByRole("combobox", { name: "Responsive padding" }).textContent,
  ).toContain("Mixed");
  fireEvent.keyDown(breakpoint, { key: "ArrowDown" });
  const option = await screen.findByRole("option", { name: "Below md · 768" });
  fireEvent.pointerDown(option, { pointerType: "mouse" });
  fireEvent.click(option);
  const [update] = apply.mock.calls[0];
  expect(geometries.map((g) => update(g).responsive)).toEqual([
    { maxWidth: 768, padding: 8 },
    { maxWidth: 768, padding: 32 },
  ]);
});

it("adds missing rules without overwriting an existing custom rule", () => {
  const layers = ["a", "b"].map((id) => ({ id, name: id, kind: "frame" }));
  const custom = { ...first, responsive: { maxWidth: 900, padding: 17 } };
  const apply = mountSelection(layers, [first, custom]);
  expect(
    screen.getByRole("combobox", { name: "Breakpoint" }).textContent,
  ).toContain("Mixed");
  fireEvent.click(screen.getByRole("button", { name: "Add responsive rule" }));
  const [update] = apply.mock.calls[0];
  expect(update(first).responsive).toEqual({ maxWidth: 640, padding: 24 });
  expect(update(custom)).toBe(custom);
});

it("aligns a large sibling selection using the full range of its coordinates", () => {
  const last = { ...first, x: 60, width: 20 };
  const layers = Array.from({ length: 250_000 }, (_, index) => ({
    id: String(index),
    parentId: "page",
    name: "Rectangle",
    kind: "frame",
  }));
  const current = Array<DesignLayerGeometry>(layers.length).fill(first);
  current[current.length - 1] = last;
  const apply = mountSelection(layers, current);
  const center = screen.getByRole("button", { name: "Align center" });
  fireEvent.click(center);
  fireEvent.click(center);
  expect(apply).toHaveBeenCalledTimes(2);
  const [align] = apply.mock.calls[0];
  expect(align(first).x).toBe(22.5);
  expect(align(last).x).toBe(17.5);
});

it("renders a replacement section without evaluating the built-in action or hidden properties", () => {
  const renderPositionAction = vi.fn();
  const geometry = {
    ...first,
    get responsive() {
      return null;
    },
  };
  const responsive = vi.spyOn(geometry, "responsive", "get");
  mountSelection(
    [{ id: "a", name: "Rectangle", kind: "frame" }],
    [geometry],
    undefined,
    {
      sections: {
        position: <button>Pin to artboard</button>,
        responsive: null,
      },
      renderPositionAction,
    },
  );
  expect(screen.getByRole("button", { name: "Pin to artboard" })).toBeDefined();
  expect(
    screen.queryByRole("button", { name: "Add responsive rule" }),
  ).toBeNull();
  expect(renderPositionAction).not.toHaveBeenCalled();
  expect(responsive).not.toHaveBeenCalled();
});

it("keeps a zero-height layer from introducing an invalid ratio in a mixed selection", () => {
  const layers = ["a", "b"].map((id) => ({ id, name: id, kind: "frame" }));
  const apply = mountSelection(layers, [first, { ...first, height: 0 }]);
  const lock = screen.getByRole("button", { name: "Lock aspect ratio" });
  fireEvent.click(lock);
  expect(apply).not.toHaveBeenCalled();
  expect(lock.hasAttribute("disabled")).toBe(true);
});

it("preserves an existing ratio when locking another layer alongside a collapsed frame", () => {
  const layers = ["a", "b"].map((id) => ({ id, name: id, kind: "frame" }));
  const collapsed = { ...first, width: 0, height: 0, aspectRatio: 2 };
  const apply = mountSelection(layers, [collapsed, first]);
  fireEvent.click(screen.getByRole("button", { name: "Lock aspect ratio" }));
  const [lock] = apply.mock.calls[0];
  expect(lock(collapsed).aspectRatio).toBe(2);
  expect(lock(first).aspectRatio).toBe(first.width / first.height);
});

it("can release an incompatible saved ratio across a mixed selection without changing geometry", () => {
  const layers = ["a", "b", "c"].map((id) => ({ id, name: id, kind: "frame" }));
  const geometry = [
    { ...first, width: 200, height: 20, aspectRatio: 10 },
    { ...first, width: 200, height: 20 },
    { ...first, width: 200, height: 0 },
  ];
  const apply = mountSelection(layers, geometry, undefined, {
    sizeLimits: { min: 25, max: 100 },
  });
  const width = screen.getByRole("textbox", { name: "Width" });
  expect((width as HTMLInputElement).value).toBe("200");
  expect(
    (screen.getByRole("textbox", { name: "Height" }) as HTMLInputElement).value,
  ).toBe("");
  expect(width.hasAttribute("readonly")).toBe(true);
  expect(screen.queryByRole("button", { name: "Width presets" })).toBeNull();
  const lock = screen.getByRole("button", { name: "Lock aspect ratio" });
  expect(lock.getAttribute("aria-pressed")).toBe("mixed");
  fireEvent.click(lock);
  const [unlock] = apply.mock.calls[0];
  expect(geometry.map(unlock)).toEqual(
    geometry.map((layer) => ({ ...layer, aspectRatio: null })),
  );
});
