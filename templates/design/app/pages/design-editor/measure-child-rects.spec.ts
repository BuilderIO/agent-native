// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { measureFreeformGeometry } from "./measure-child-rects";

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
  doc.body.innerHTML = `<div data-agent-native-node-id="box" style="${containerStyle}"><span data-agent-native-node-id="kid"></span></div>`;
  const container = doc.querySelector('[data-agent-native-node-id="box"]')!;
  const child = doc.querySelector('[data-agent-native-node-id="kid"]')!;
  stubRect(container, 100, 50);
  stubRect(child, 110, 70);
  return { container, child };
}

describe("measureFreeformGeometry", () => {
  it("measures a child against an unbordered container's origin", () => {
    mountPreview("position:relative");
    expect(measureFreeformGeometry("box").children.kid).toMatchObject({
      x: 10,
      y: 20,
    });
  });

  it("measures from the padding box, which is where absolute offsets resolve", () => {
    mountPreview(
      "position:relative;border-left-width:4px;border-top-width:6px;border-style:solid",
    );
    expect(measureFreeformGeometry("box").children.kid).toMatchObject({
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

    // The child sits 10/20 below the container on screen, but the container is
    // scrolled, so its position in the content box is 30/15 further along.
    expect(measureFreeformGeometry("box").children.kid).toMatchObject({
      x: 40,
      y: 35,
    });
  });
});
