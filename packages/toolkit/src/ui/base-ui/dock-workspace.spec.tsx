// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { DockWorkspace, type DockLayout } from "./dock-workspace.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("reports an invalid controlled layout before traversing its panel slots", () => {
  const canvas: DockLayout = {
    type: "surface",
    id: "document",
    panel: "canvas",
  };
  const layout: DockLayout = {
    type: "split",
    id: "outer",
    axis: "inline",
    side: "end",
    size: 240,
    first: canvas,
    second: canvas,
  };
  layout.first = layout;
  expect(() =>
    render(
      <DockWorkspace
        label="Workspace"
        layout={layout}
        panels={[{ id: "canvas", label: "Canvas", content: "Canvas" }]}
        onLayoutChange={vi.fn()}
      />,
    ),
  ).toThrow("Dock layout must contain every registered panel exactly once.");
});

it("keeps the canvas and inspector reachable at the outer divider's keyboard and pointer limits", () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(520);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(12);
  const layout: DockLayout = {
    type: "split",
    id: "outer",
    axis: "inline",
    side: "start",
    size: 200,
    first: {
      type: "group",
      id: "navigation",
      tabs: ["layers"],
      active: "layers",
    },
    second: {
      type: "split",
      id: "inner",
      axis: "inline",
      side: "end",
      size: 100,
      first: { type: "surface", id: "document", panel: "canvas" },
      second: {
        type: "group",
        id: "properties",
        tabs: ["inspector"],
        active: "inspector",
      },
    },
  };
  const change = vi.fn();
  render(
    <DockWorkspace
      label="Workspace"
      layout={layout}
      onLayoutChange={change}
      panels={["layers", "canvas", "inspector"].map((id) => ({
        id,
        label: id,
        content: id,
      }))}
    />,
  );
  const divider = screen.getByRole("separator", { name: "Resize layers" });
  expect(divider.getAttribute("aria-valuemax")).toBe("336");
  fireEvent.keyDown(divider, { key: "End" });
  expect(change).toHaveBeenLastCalledWith({ ...layout, size: 336 });
  change.mockClear();
  Object.assign(divider, {
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  });
  const pointer = { pointerId: 1, button: 0, isPrimary: true };
  fireEvent.pointerDown(divider, { ...pointer, clientX: 200 });
  fireEvent.pointerUp(divider, { ...pointer, clientX: 520 });
  expect(change).toHaveBeenLastCalledWith({ ...layout, size: 336 });
});

it.each(["document", "shadow"] as const)(
  "restores keyboard focus when a controlled layout rebuilds a panel slot in a %s root",
  (mode) => {
    const panels = [
      {
        id: "layers",
        label: "Layers",
        content: <input aria-label="Layer name" />,
      },
      {
        id: "inspector",
        label: "Inspector",
        content: <input aria-label="Width" />,
      },
    ];
    const workspace = (id: string, active: string) => (
      <DockWorkspace
        layout={{ type: "group", id, tabs: ["layers", "inspector"], active }}
        onLayoutChange={vi.fn()}
        panels={panels}
        label="Workspace"
      />
    );
    const host = document.body.appendChild(document.createElement("div"));
    const scope =
      mode === "shadow" ? host.attachShadow({ mode: "open" }) : document;
    const container = (mode === "shadow" ? scope : host).appendChild(
      document.createElement("div"),
    );
    const { rerender, getByRole, unmount } = render(
      workspace("desktop", "inspector"),
      { container, baseElement: container },
    );
    const width = getByRole("textbox", { name: "Width" });
    width.focus();
    rerender(workspace("floating", "inspector"));
    expect(scope.activeElement).toBe(width);
    rerender(workspace("compact", "layers"));
    expect(scope.activeElement).toBe(getByRole("tab", { name: "Layers" }));
    unmount();
    host.remove();
  },
);

it("returns focus to the remaining group tab when its focused tool is removed", () => {
  const layers = { id: "layers", label: "Layers", content: "Layers" };
  const inspector = {
    id: "inspector",
    label: "Inspector",
    content: <input aria-label="Width" />,
  };
  const workspace = (open: boolean) => {
    const panels = open ? [layers, inspector] : [layers];
    return (
      <DockWorkspace
        label="Workspace"
        panels={panels}
        onLayoutChange={vi.fn()}
        layout={{
          type: "group",
          id: "tools",
          active: open ? inspector.id : layers.id,
          tabs: panels.map((p) => p.id),
        }}
      />
    );
  };
  const { rerender } = render(workspace(true));
  screen.getByRole("textbox", { name: "Width" }).focus();
  rerender(workspace(false));
  expect(
    screen.queryByRole("textbox", { name: "Width", hidden: true }),
  ).toBeNull();
  expect(document.activeElement).toBe(
    screen.getByRole("tab", { name: "Layers" }),
  );
});

it("mounts one content host per visited panel under Strict Mode", () => {
  const { container } = render(
    <StrictMode>
      <DockWorkspace
        label="Workspace"
        panels={[{ id: "canvas", label: "Canvas", content: <canvas /> }]}
        layout={{ type: "surface", id: "document", panel: "canvas" }}
        onLayoutChange={vi.fn()}
      />
    </StrictMode>,
  );
  const slot = container.querySelector('[data-dock-slot="canvas"]');
  expect(slot?.children.length).toBe(1);
  expect(slot?.firstElementChild?.firstElementChild?.tagName).toBe("CANVAS");
});

it("returns focus to Arrange when the host declines a move and ignores unrelated layout updates", async () => {
  const request = vi.fn();
  const group = {
    type: "group",
    id: "tools",
    tabs: ["layers", "assets"],
    active: "layers",
  } as const;
  const view = (layout: DockLayout) => (
    <DockWorkspace
      label="Workspace"
      layout={layout}
      onLayoutChange={request}
      panels={[
        {
          id: "layers",
          label: "Layers",
          content: <input aria-label="Filter layers" />,
        },
        { id: "assets", label: "Assets", content: null },
      ]}
    />
  );
  const { rerender } = render(view(group));
  const arrange = screen.getByRole("button", { name: "Arrange Layers" });
  arrange.focus();
  await act(async () => {
    fireEvent.keyDown(arrange, { key: "ArrowDown" });
  });
  const later = await screen.findByRole("menuitem", { name: "Move tab later" });
  later.focus();
  await act(async () => {
    fireEvent.click(later);
  });
  expect(request).toHaveBeenCalledOnce();
  await waitFor(() => expect(document.activeElement).toBe(arrange));
  const input = screen.getByRole("textbox", { name: "Filter layers" });
  input.focus();
  rerender(view({ ...group }));
  expect(document.activeElement).toBe(input);
});

function dockPointerFixture() {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(540);
  const host = document.body.appendChild(document.createElement("div"));
  const shadow = host.attachShadow({ mode: "open" });
  const container = shadow.appendChild(document.createElement("div"));
  const request = vi.fn<(layout: DockLayout) => void>();
  const layout: DockLayout = {
    type: "split",
    id: "split",
    axis: "inline",
    side: "end",
    size: 240,
    first: {
      type: "group",
      id: "left",
      tabs: ["Layers", "Assets"],
      active: "Layers",
    },
    second: {
      type: "group",
      id: "right",
      tabs: ["Inspector"],
      active: "Inspector",
    },
  };
  const panels = ["Layers", "Assets", "Inspector"].map((id) => ({
    id,
    label: id,
    content: id,
  }));
  const view = render(
    <DockWorkspace
      label="Tools"
      panels={panels}
      layout={layout}
      onLayoutChange={request}
    />,
    { container, baseElement: container },
  );
  const tab = (name: string) => view.getByRole("tab", { name });
  const rail = (name: string) => view.getByRole("tablist", { name });
  const rect = (element: Element, x: number, width: number) =>
    vi
      .spyOn(element, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(x, 0, width, 24));
  const layers = tab("Layers"),
    assets = tab("Assets"),
    inspector = tab("Inspector");
  const leftRail = rail("Layers, Assets"),
    rightRail = rail("Inspector");
  rect(layers, 4, 60);
  rect(assets, 64, 60);
  const inspectorBounds = rect(inspector, 304, 80);
  rect(leftRail, 0, 290);
  rect(rightRail, 300, 200);
  const arrange = view.getByRole("button", { name: "Arrange Inspector" });
  rect(arrange, 500, 30);
  const inspectorPanel = view.getByRole("tabpanel", { name: "Inspector" });
  const group = inspectorPanel.parentElement;
  if (!group) throw new Error("Missing inspector panel group");
  vi.spyOn(group, "getBoundingClientRect").mockReturnValue(
    new DOMRect(300, 0, 230, 320),
  );
  Object.assign(shadow, {
    elementFromPoint(x: number, y: number) {
      if (x >= 300 && x < 530 && y >= 24 && y < 320) return inspectorPanel;
      for (const element of [
        layers,
        assets,
        inspector,
        leftRail,
        rightRail,
        arrange,
      ]) {
        const bounds = element.getBoundingClientRect();
        if (x >= bounds.left && x < bounds.right) return element;
      }
      return null;
    },
  });
  function gesture(source: HTMLElement, start: number, y = 12) {
    Object.assign(source, {
      setPointerCapture: vi.fn<(pointerId: number) => void>(),
    });
    const pointer = {
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      clientY: y,
    };
    fireEvent.pointerDown(source, { ...pointer, clientX: start });
    return {
      move: (x: number, clientY = y) =>
        fireEvent.pointerMove(source, {
          ...pointer,
          buttons: 1,
          clientX: x,
          clientY,
        }),
      release: (x: number, clientY = y) =>
        fireEvent.pointerUp(source, { ...pointer, clientX: x, clientY }),
    };
  }
  return {
    layers,
    assets,
    inspector,
    inspectorBounds,
    gesture,
    request,
    layout,
    close() {
      view.unmount();
      host.remove();
    },
  };
}

it("inserts Assets before Layers from the rail gutter before the first preview frame", () => {
  const dock = dockPointerFixture();
  try {
    const pointer = dock.gesture(dock.assets, 90);
    pointer.move(3);
    pointer.release(3);
    expect(dock.request).toHaveBeenLastCalledWith({
      ...dock.layout,
      first: {
        type: "group",
        id: "left",
        tabs: ["Assets", "Layers"],
        active: "Assets",
      },
    });
  } finally {
    dock.close();
  }
});

it.each([
  { geometry: "stable", left: 304, width: 80, tabs: ["Layers", "Inspector"] },
  { geometry: "resized", left: 240, width: 132, tabs: ["Inspector", "Layers"] },
])(
  "resolves Layers beside Inspector against a $geometry tab after the pointer crosses its midpoint",
  async ({ left, width, tabs }) => {
    const dock = dockPointerFixture();
    try {
      const pointer = dock.gesture(dock.layers, 32);
      pointer.move(343);
      await waitFor(() =>
        expect(dock.inspector.getAttribute("data-dock-insert")).toBe("before"),
      );
      dock.inspectorBounds.mockReturnValue(new DOMRect(left, 0, width, 24));
      pointer.move(345);
      pointer.release(345);
      expect(dock.request).toHaveBeenLastCalledWith({
        ...dock.layout,
        first: {
          type: "group",
          id: "left",
          tabs: ["Assets"],
          active: "Assets",
        },
        second: {
          type: "group",
          id: "right",
          tabs,
          active: "Layers",
        },
      });
    } finally {
      dock.close();
    }
  },
);

it("keeps a horizontal drag on the tab strip through the Arrange button", async () => {
  const dock = dockPointerFixture();
  try {
    const pointer = dock.gesture(dock.layers, 32, 1);
    pointer.move(515);
    await waitFor(() =>
      expect(dock.inspector.getAttribute("data-dock-insert")).toBe("after"),
    );
    pointer.release(515);
    expect(dock.request).toHaveBeenCalledWith({
      ...dock.layout,
      first: { type: "group", id: "left", tabs: ["Assets"], active: "Assets" },
      second: {
        type: "group",
        id: "right",
        tabs: ["Inspector", "Layers"],
        active: "Layers",
      },
    });
  } finally {
    dock.close();
  }
});

it("leaves the layout unchanged when the pointer leaves an insertion marker for the content center", async () => {
  const dock = dockPointerFixture();
  try {
    const pointer = dock.gesture(dock.layers, 32);
    pointer.move(325);
    await waitFor(() =>
      expect(dock.inspector.getAttribute("data-dock-insert")).toBe("before"),
    );
    pointer.move(415, 170);
    pointer.release(415, 170);
    expect(dock.request).not.toHaveBeenCalled();
  } finally {
    dock.close();
  }
});
