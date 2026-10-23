// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { measureFrameElement } from "./measure-child-rects";

function stubRect(element: Element, left: number, top: number) {
  element.getBoundingClientRect = () =>
    ({ left, top, width: 40, height: 20 }) as DOMRect;
}

function mountPreview(containerStyle: string) {
  document.body.innerHTML = "";
  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-design-preview-iframe", "");
  document.body.append(iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML = `<div data-agent-native-node-id="box" style="width:120px;height:80px;${containerStyle}"><span data-agent-native-node-id="kid"></span><i></i></div>`;
  const container = doc.querySelector('[data-agent-native-node-id="box"]')!;
  const child = doc.querySelector('[data-agent-native-node-id="kid"]')!;
  stubRect(container, 100, 50);
  stubRect(child, 110, 70);
  return { container, child };
}

const kidRect = (container: Element) => {
  const measured = measureFrameElement(container);
  if (measured.status !== "measured") throw new Error(measured.reason);
  return measured.children.find((child) => child.id === "kid")?.rect;
};

describe("measureFrameElement", () => {
  it("measures a child against an unbordered container's origin", () => {
    const { container } = mountPreview("position:relative");
    expect(kidRect(container)).toMatchObject({
      x: 10,
      y: 20,
    });
  });

  it("measures from the padding box, which is where absolute offsets resolve", () => {
    const { container } = mountPreview(
      "position:relative;border-left-width:4px;border-top-width:6px;border-style:solid",
    );
    expect(kidRect(container)).toMatchObject({
      x: 6,
      y: 14,
    });
  });

  it("measures against the content box, not the scrolled viewport position", () => {
    const { container } = mountPreview("position:relative;overflow:auto");
    Object.defineProperty(container, "scrollLeft", {
      value: 30,
      writable: true,
    });
    Object.defineProperty(container, "scrollTop", {
      value: 15,
      writable: true,
    });

    expect(kidRect(container)).toMatchObject({
      x: 40,
      y: 35,
    });
  });

  it("counts children no edit can address instead of dropping them", () => {
    const { container } = mountPreview("position:relative");
    const measured = measureFrameElement(container);
    expect(measured).toMatchObject({
      status: "measured",
      size: { width: 120, height: 80 },
      unidentifiedChildren: 1,
    });
  });

  it("refuses a frame that is not rendered", () => {
    const { container } = mountPreview("display:none");
    (container as HTMLElement).style.width = "auto";
    expect(measureFrameElement(container).status).toBe("unmeasurable");
  });
});

describe("measureFrameElement under a transform", () => {
  it("refuses a frame whose own transform scales or rotates its children", () => {
    const { container } = mountPreview("transform: scale(2)");
    expect(measureFrameElement(container)).toEqual({
      status: "unmeasurable",
      reason: "transformed",
    });
  });

  it("refuses a frame inside a rotated ancestor", () => {
    const { container } = mountPreview("");
    (container.parentElement as HTMLElement).style.transform = "rotate(45deg)";
    expect(measureFrameElement(container)).toMatchObject({
      status: "unmeasurable",
      reason: "transformed",
    });
  });

  it("still measures a frame that is only translated", () => {
    const { container } = mountPreview("transform: translate(12px, 4px)");
    expect(kidRect(container)).toMatchObject({ x: 10, y: 20 });
  });
});
