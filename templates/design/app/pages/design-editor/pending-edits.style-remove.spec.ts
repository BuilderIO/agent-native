// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { applyScopedVisualStyleEdit } from "./pending-edits";

const OPEN_PATH = `<!DOCTYPE html><html><body><svg data-agent-native-node-id="v1" data-an-primitive="path" viewBox="0 0 200 140" style="position: absolute; left: 0px; top: 0px; width: 200px; height: 140px" data-an-pen-nodes="[0,[0,140,null,null,null,null,null],[200,120,null,null,null,null,null],[100,0,null,null,null,null,null]]"><path d="M 0 140 L 200 120 L 100 0" fill="none" fill-opacity="0" stroke="#000000" style="fill: rgb(0, 0, 0); fill-opacity: 1; stroke: none"></path></svg></body></html>`;

describe("applyScopedVisualStyleEdit with an empty value", () => {
  it("removes the base declaration from a vector's paint element", () => {
    const patch = applyScopedVisualStyleEdit({
      content: OPEN_PATH,
      target: { nodeId: "v1" },
      property: "fillOpacity",
      value: "",
      upperBoundPx: null,
    });

    expect(patch.result.status).toBe("applied");
    const path = new DOMParser()
      .parseFromString(patch.content, "text/html")
      .querySelector('[data-agent-native-node-id="v1"] path')!;
    expect(path.getAttribute("style")).not.toContain("fill-opacity");
    expect(path.getAttribute("fill-opacity")).toBe("0");
    expect(path.getAttribute("style")).toContain("fill: rgb(0, 0, 0)");
  });
});

describe("applyScopedVisualStyleEdit with an empty value at a breakpoint", () => {
  it("succeeds so a Shift+X batch is not refused when nothing is scoped there", () => {
    const patch = applyScopedVisualStyleEdit({
      content: OPEN_PATH,
      target: { nodeId: "v1" },
      property: "fillOpacity",
      value: "",
      upperBoundPx: 768,
    });

    expect(patch.result.status).toBe("applied");
  });

  it("removes a declaration scoped to that breakpoint", () => {
    const scoped = applyScopedVisualStyleEdit({
      content: OPEN_PATH,
      target: { nodeId: "v1" },
      property: "fillOpacity",
      value: "0.35",
      upperBoundPx: 768,
    });
    expect(scoped.result.status).toBe("applied");
    expect(scoped.content).toContain("0.35");

    const cleared = applyScopedVisualStyleEdit({
      content: scoped.content,
      target: { nodeId: "v1" },
      property: "fillOpacity",
      value: "",
      upperBoundPx: 768,
    });

    expect(cleared.result.status).toBe("applied");
    expect(cleared.content).not.toContain("0.35");
  });
});
