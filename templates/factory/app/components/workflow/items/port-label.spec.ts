import { describe, expect, it } from "vitest";

import { createEnglishTranslator } from "@/lib/__tests__/en-translator";
import type { WorkflowNode } from "@/lib/workflow-editor";

import { createWorkflowCanvasStrings } from "../../workflow-canvas/strings";
import { createItemsStrings } from "../items-strings";
import { portLabeler as portLabelerOf } from "./port-label";

const t = createEnglishTranslator();
const portLabeler = (graph: Parameters<typeof portLabelerOf>[0]) =>
  portLabelerOf(graph, createItemsStrings(t), createWorkflowCanvasStrings(t));

const route = {
  id: "route",
  name: "route",
  kind: "switch",
  position: { x: 0, y: 0 },
  settings: {
    routes: [
      { id: "needsInfo", label: "Needs info", rules: [] },
      { id: "clear", label: "Clear and safe", rules: [] },
    ],
  },
} as unknown as WorkflowNode;

const ask = {
  id: "ask",
  name: "ask",
  kind: "action",
  position: { x: 0, y: 0 },
  settings: {},
} as unknown as WorkflowNode;

describe("portLabeler", () => {
  const label = portLabeler({ nodes: [route, ask] });

  it("names a Switch route by the label its author gave it", () => {
    expect(label("route", "route:needsInfo")).toBe("Needs info");
    expect(label("route", "route:clear")).toBe("Clear and safe");
  });

  it("uses the common name of a plain port", () => {
    expect(label("ask", "out")).toBe("Next");
    expect(label("route", "otherwise")).toBe("Otherwise");
  });

  it("calls a Wait's parked count Parked, since no edge leaves by it", () => {
    expect(label("ask", "parked")).toBe("Parked");
    expect(label("gone", "parked")).toBe("Parked");
  });

  it("shows a port of a step the graph lacks as recorded, without the route prefix", () => {
    expect(label("gone", "route:clear")).toBe("clear");
    expect(portLabeler(undefined)("ask", "out")).toBe("out");
  });
});
