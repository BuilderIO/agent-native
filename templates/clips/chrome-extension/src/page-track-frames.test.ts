// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import { blockedFrameFilter } from "./page-track-frames";

const BLOCK = "iframe[data-agent-native-session-replay], [data-private]";

function mirror(entries: [number, Node][]): (id: number) => Node | null {
  const nodes = new Map(entries);
  return (id) => nodes.get(id) ?? null;
}

function attach(parentId: number, childId: number) {
  return {
    type: 3,
    data: {
      source: 0,
      isAttachIframe: true,
      adds: [{ parentId, nextId: null, node: { type: 0, id: childId } }],
      removes: [],
      texts: [],
      attributes: [],
    },
  };
}

function input(id: number) {
  return { type: 3, data: { source: 5, id, text: "typed", isChecked: false } };
}

function textChange(id: number) {
  return {
    type: 3,
    data: {
      source: 0,
      adds: [],
      removes: [],
      texts: [{ id, value: "changed" }],
      attributes: [],
    },
  };
}

function mouseMove(id: number) {
  return {
    type: 3,
    data: { source: 1, positions: [{ x: 1, y: 1, id, timeOffset: 0 }] },
  };
}

function frameWithField(attributes: Record<string, string>) {
  const frame = document.createElement("iframe");
  for (const [name, value] of Object.entries(attributes)) {
    frame.setAttribute(name, value);
  }
  document.body.append(frame);
  const frameDocument = document.implementation.createHTMLDocument("frame");
  const field = frameDocument.createElement("input");
  frameDocument.body.append(field);
  return { frame, frameDocument, field };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("blocked iframes in the page track", () => {
  it("leaves out a blocked iframe's document and what happens inside it", () => {
    const { frame, frameDocument, field } = frameWithField({
      "data-agent-native-session-replay": "",
    });
    const pageField = document.createElement("input");
    document.body.append(pageField);
    const keep = blockedFrameFilter(
      BLOCK,
      mirror([
        [1, frame],
        [2, frameDocument],
        [3, field],
        [4, pageField],
      ]),
    );

    expect(keep(attach(1, 2))).toBe(false);
    expect(keep(input(3))).toBe(false);
    expect(keep(textChange(3))).toBe(false);
    expect(keep(mouseMove(3))).toBe(false);
    expect(keep(input(4))).toBe(true);
    expect(keep({ type: 2, data: { node: {} } })).toBe(true);
  });

  it("keeps an iframe that isn't blocked", () => {
    const { frame, frameDocument, field } = frameWithField({});
    const keep = blockedFrameFilter(
      BLOCK,
      mirror([
        [1, frame],
        [2, frameDocument],
        [3, field],
      ]),
    );

    expect(keep(attach(1, 2))).toBe(true);
    expect(keep(input(3))).toBe(true);
  });

  it("leaves out an iframe nested in a blocked one", () => {
    const { frame, frameDocument } = frameWithField({ "data-private": "" });
    const nested = frameDocument.createElement("iframe");
    frameDocument.body.append(nested);
    const nestedDocument = document.implementation.createHTMLDocument("inner");
    const nestedField = nestedDocument.createElement("input");
    nestedDocument.body.append(nestedField);
    const keep = blockedFrameFilter(
      BLOCK,
      mirror([
        [1, frame],
        [2, frameDocument],
        [3, nested],
        [4, nestedDocument],
        [5, nestedField],
      ]),
    );

    expect(keep(attach(1, 2))).toBe(false);
    expect(keep(attach(3, 4))).toBe(false);
    expect(keep(input(5))).toBe(false);
  });
});
