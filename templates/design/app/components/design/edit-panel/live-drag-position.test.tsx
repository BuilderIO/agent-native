// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useLiveDragPosition } from "./live-drag-position";

function Probe({ selector }: { selector: string }) {
  const live = useLiveDragPosition(selector);
  return <output>{live ? `${live.left},${live.top}` : "none"}</output>;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function post(data: Record<string, unknown>) {
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", { data }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

describe("useLiveDragPosition", () => {
  it("follows the dragged element and lets go when the gesture ends", async () => {
    await act(async () => root.render(<Probe selector="#box" />));
    const text = () => container.querySelector("output")?.textContent;

    await post({
      type: "agent-native:live-drag-position",
      selector: "#other",
      active: true,
      left: "9px",
      top: "9px",
    });
    expect(text()).toBe("none");

    await post({
      type: "agent-native:live-drag-position",
      selector: "#box",
      active: true,
      left: "140px",
      top: "60px",
    });
    expect(text()).toBe("140px,60px");

    await post({
      type: "agent-native:live-drag-position",
      selector: "#box",
      active: false,
      left: "140px",
      top: "60px",
    });
    expect(text()).toBe("none");
  });
});
