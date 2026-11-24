// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SplitPane, type SplitPaneProps } from "./split-pane.js";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(700);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount(props: Partial<SplitPaneProps> = {}, container?: HTMLElement) {
  const onSizeChange = vi.fn();
  const view = render(
    <SplitPane
      pane={<a href="#layers">Layers</a>}
      label="Pane width"
      defaultSize={200}
      minSize={96}
      maxSize={400}
      collapsible
      onSizeChange={onSizeChange}
      {...props}
    >
      Canvas
    </SplitPane>,
    { container },
  );
  const grip = view.getByRole("separator", { name: "Pane width" });
  const captured = new Set<number>();
  Object.assign(grip, {
    setPointerCapture: (id: number) => captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: (id: number) => captured.delete(id),
  });
  const pointer = {
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    button: 0,
  };
  return {
    grip,
    captured,
    onSizeChange,
    view,
    down: () => fireEvent.pointerDown(grip, { ...pointer, clientX: 200 }),
    move: (x: number) =>
      fireEvent.pointerMove(grip, { ...pointer, clientX: x }),
    up: (x: number) => fireEvent.pointerUp(grip, { ...pointer, clientX: x }),
  };
}
it("coalesces previews, ignores another pointer, and commits a pending final position exactly once", () => {
  let paint: FrameRequestCallback | undefined;
  const queued = vi.fn((next: FrameRequestCallback) => {
    paint = next;
    return 1;
  });
  vi.stubGlobal("requestAnimationFrame", queued);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const { grip, down, move, up, captured, onSizeChange } = mount();
  down();
  fireEvent.pointerMove(grip, { pointerId: 3, clientX: 500 });
  move(230);
  move(260);
  expect(queued).toHaveBeenCalledTimes(1);
  act(() => paint?.(0));
  expect(onSizeChange.mock.calls).toEqual([[260, { phase: "preview" }]]);
  expect(grip.getAttribute("aria-valuenow")).toBe("260");
  move(260);
  expect(queued).toHaveBeenCalledTimes(1);
  move(270);
  up(270);
  expect(onSizeChange.mock.calls).toEqual([
    [260, { phase: "preview" }],
    [270, { phase: "commit" }],
  ]);
  expect(grip.getAttribute("aria-valuenow")).toBe("270");
  expect(captured.size).toBe(0);
});
it("commits pointer movement in layout pixels inside a scaled preview", () => {
  const { grip, down, up, onSizeChange } = mount();
  const split = grip.parentElement;
  if (!split) throw new Error("Expected a mounted splitter");
  vi.spyOn(split, "offsetWidth", "get").mockReturnValue(700);
  vi.spyOn(split, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 350, 180),
  );
  down();
  up(224);
  expect(onSizeChange).toHaveBeenCalledExactlyOnceWith(248, {
    phase: "commit",
  });
});
it.each([
  "pointerCancel",
  "lostPointerCapture",
  "window blur",
  "unmount",
] as const)("discards an unfinished resize on %s", (kind) => {
  const { grip, down, move, captured, onSizeChange, view } = mount();
  down();
  move(300);
  if (kind === "unmount") view.unmount();
  else if (kind === "window blur") fireEvent.blur(window);
  else fireEvent[kind](grip, { pointerId: 1 });
  expect(onSizeChange.mock.calls).toEqual([[200, { phase: "cancel" }]]);
  expect(captured.size).toBe(0);
});
it("disabling the separator cancels its gesture and leaves both panes interactive", () => {
  const { grip, down, move, up, captured, onSizeChange, view } = mount();
  down();
  move(300);
  const pane = <a href="#layers">Layers</a>;
  function layout(disabled: boolean) {
    return (
      <SplitPane
        pane={pane}
        label="Pane width"
        defaultSize={200}
        minSize={96}
        maxSize={400}
        collapsible
        disabled={disabled}
        onSizeChange={onSizeChange}
      >
        Canvas
      </SplitPane>
    );
  }
  view.rerender(layout(true));
  expect(captured.size).toBe(0);
  expect(grip.tabIndex).toBe(-1);
  expect(grip.getAttribute("aria-disabled")).toBe("true");
  expect(
    screen.getByRole("link", { name: "Layers" }).closest("[inert]"),
  ).toBeNull();
  down();
  up(350);
  fireEvent.keyDown(grip, { key: "End" });
  expect(grip.getAttribute("aria-valuenow")).toBe("200");
  expect(onSizeChange.mock.calls).toEqual([[200, { phase: "cancel" }]]);
  view.rerender(layout(false));
  expect(grip.tabIndex).toBe(0);
  fireEvent.keyDown(grip, { key: "ArrowRight" });
  expect(grip.getAttribute("aria-valuenow")).toBe("208");
});
it("retains the controlled size when a host declines the commit", () => {
  const { grip, down, up, onSizeChange } = mount({ size: 220 });
  down();
  up(224);
  expect(onSizeChange).toHaveBeenCalledWith(244, { phase: "commit" });
  expect(grip.getAttribute("aria-valuenow")).toBe("220");
});

it.each(["release", "blur"])(
  "preserves an external resize on pointer %s",
  (finish) => {
    const { grip, down, move, up, onSizeChange, view } = mount({ size: 200 });
    down();
    move(290);
    view.rerender(
      <SplitPane
        pane="Layers"
        label="Pane width"
        size={240}
        minSize={96}
        maxSize={400}
        collapsible
        onSizeChange={onSizeChange}
      >
        Canvas
      </SplitPane>,
    );
    if (finish === "blur") fireEvent.blur(window);
    up(290);
    expect(onSizeChange.mock.calls).toEqual([[240, { phase: "cancel" }]]);
    expect(grip.getAttribute("aria-valuenow")).toBe("240");
  },
);

it("continues a controlled drag when the host echoes the painted preview", () => {
  let paint: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
    paint = fn;
    return 1;
  });
  const { down, move, up, captured, onSizeChange, view } = mount({ size: 200 });
  down();
  move(240);
  act(() => paint?.(0));
  view.rerender(
    <SplitPane
      pane="Layers"
      label="Pane width"
      size={240}
      minSize={96}
      maxSize={400}
      collapsible
      onSizeChange={onSizeChange}
    >
      Canvas
    </SplitPane>,
  );
  expect(captured.size).toBe(1);
  up(260);
  expect(onSizeChange.mock.calls).toEqual([
    [240, { phase: "preview" }],
    [260, { phase: "commit" }],
  ]);
});

it("cancels a pending drag at the rendered size when the host reduces its limit", () => {
  const { grip, down, move, up, captured, onSizeChange, view } = mount();
  down();
  move(300);
  view.rerender(
    <SplitPane
      pane="Layers"
      label="Pane width"
      defaultSize={200}
      minSize={96}
      maxSize={160}
      collapsible
      onSizeChange={onSizeChange}
    >
      Canvas
    </SplitPane>,
  );
  up(300);
  expect(captured.size).toBe(0);
  expect(grip.getAttribute("aria-valuenow")).toBe("160");
  expect(onSizeChange.mock.calls).toEqual([[160, { phase: "cancel" }]]);
});

it.each([
  ["ArrowLeft", false, 200],
  ["ArrowRight", false, 208],
  ["ArrowLeft", true, 128],
  ["ArrowRight", true, 280],
] as const)(
  "resumes the snap grid from a saved off-grid size on %s (shift %s)",
  (key, shiftKey, expected) => {
    const { down, up, grip, onSizeChange } = mount({
      defaultSize: 203,
      snapToStep: true,
    });
    down();
    up(200);
    expect(onSizeChange).not.toHaveBeenCalled();
    fireEvent.keyDown(grip, { key, shiftKey });
    expect(onSizeChange.mock.calls).toEqual([[expected, { phase: "commit" }]]);
    expect(grip.getAttribute("aria-valuenow")).toBe(String(expected));
  },
);

it.each([
  [201, 201, 201],
  [199, 201, 200],
  [201, 199, 200],
  [200, 201, 201],
  [200, 195, 195],
  [197, 199, 197],
] as const)(
  "snaps a drag from %i at pointer %i to %i with off-grid bounds",
  (start, pointer, expected) => {
    const { down, up, grip } = mount({
      defaultSize: start,
      minSize: 195,
      maxSize: 201,
      snapToStep: true,
    });
    down();
    up(pointer);
    expect(grip.getAttribute("aria-valuenow")).toBe(String(expected));
  },
);

it("leaves intercepted and composing keys to the host and toggles once per Enter press", () => {
  const { grip, onSizeChange } = mount({
    onKeyDownCapture: (event) => {
      if (event.key === "End") event.preventDefault();
    },
  });
  fireEvent.keyDown(grip, { key: "End" });
  fireEvent.keyDown(grip, { key: "Enter", isComposing: true });
  expect(onSizeChange).not.toHaveBeenCalled();
  fireEvent.keyDown(grip, { key: "Enter" });
  fireEvent.keyDown(grip, { key: "Enter", repeat: true });
  expect(grip.getAttribute("aria-valuenow")).toBe("0");
  fireEvent.keyDown(grip, { key: "Enter" });
  expect(onSizeChange.mock.calls).toEqual([
    [0, { phase: "commit" }],
    [200, { phase: "commit" }],
  ]);
});

it("returns focus from a pane collapsed by its host to the separator", () => {
  const layout = (size: number) => (
    <SplitPane
      size={size}
      collapsible
      label="Pane width"
      pane={<button>Layer</button>}
    >
      Canvas
    </SplitPane>
  );
  const view = render(layout(200));
  screen.getByRole("button", { name: "Layer" }).focus();
  view.rerender(layout(0));
  expect(document.activeElement).toBe(screen.getByRole("separator"));
});

it("resizes across consecutive fractional snap points in either direction", () => {
  const { grip } = mount({ defaultSize: 100.1, step: 0.1, snapToStep: true });
  for (const [key, value] of [
    ["ArrowRight", "100.2"],
    ["ArrowRight", "100.3"],
    ["ArrowLeft", "100.2"],
    ["ArrowLeft", "100.1"],
  ]) {
    fireEvent.keyDown(grip, { key });
    expect(grip.getAttribute("aria-valuenow")).toBe(value);
  }
});

it("paints and cancels pointer previews on the pane's own window", () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  try {
    const doc = frame.contentDocument;
    if (!doc) throw new Error("Expected an iframe document");
    const win = doc.defaultView;
    if (!win) throw new Error("Expected a preview window");
    vi.spyOn(win.HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
      700,
    );
    let paint: FrameRequestCallback | undefined;
    vi.spyOn(win, "requestAnimationFrame").mockImplementation((callback) => {
      paint = callback;
      return 17;
    });
    const cancel = vi.spyOn(win, "cancelAnimationFrame");
    const { down, move, grip, onSizeChange, view } = mount(
      {},
      doc.body.appendChild(doc.createElement("div")),
    );
    down();
    move(240);
    act(() => paint?.(0));
    expect(onSizeChange.mock.calls).toEqual([[240, { phase: "preview" }]]);
    move(250);
    fireEvent.blur(win);
    expect(cancel).toHaveBeenCalledWith(17);
    expect(grip.getAttribute("aria-valuenow")).toBe("200");
    view.unmount();
  } finally {
    frame.remove();
  }
});
