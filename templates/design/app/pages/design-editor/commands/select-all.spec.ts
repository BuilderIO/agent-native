import {
  buildCodeLayerProjection,
  buildCodeLayerTree,
} from "@shared/code-layer";
import { describe, expect, it } from "vitest";

import { runSelectAll } from "./select-all";

const TODO_SCREEN = `<body>
  <section class="card">
    <h2>Todo</h2>
    <ul>
      <template x-for="todo in todos">
        <li class="row"><span class="dot"></span><span class="label" x-text="todo.text"></span><input class="check" type="checkbox" x-model="todo.done" /></li>
      </template>
      <li class="static"><span class="dot"></span><span class="hint">+ Add a task</span><input class="entry" type="text" /></li>
    </ul>
  </section>
  <section class="card"><h2>Velocity</h2></section>
</body>`;

function treeOf(html: string) {
  return buildCodeLayerTree(buildCodeLayerProjection(html));
}

function idOfClass(html: string, className: string): string {
  const node = buildCodeLayerProjection(html).nodes.find((candidate) =>
    candidate.classes.includes(className),
  );
  if (!node) throw new Error(`no node with class ${className}`);
  return node.id;
}

describe("select-all with a layer selected", () => {
  it("selects the selected row's siblings instead of falling back", () => {
    const tree = treeOf(TODO_SCREEN);

    const decision = runSelectAll({
      tree,
      selectedLayerIds: [idOfClass(TODO_SCREEN, "row")],
      nonLayerIds: new Set(),
      fallback: "screens",
    });

    expect(decision).toEqual({
      kind: "layers",
      layerIds: [
        idOfClass(TODO_SCREEN, "row"),
        idOfClass(TODO_SCREEN, "static"),
      ],
    });
  });

  it("keeps the anchor row in the selection", () => {
    const anchor = idOfClass(TODO_SCREEN, "static");

    const decision = runSelectAll({
      tree: treeOf(TODO_SCREEN),
      selectedLayerIds: [anchor],
      nonLayerIds: new Set(),
      fallback: "screens",
    });

    expect(decision.kind === "layers" && decision.layerIds).toContain(anchor);
  });

  it("reaches a nested selection, not just a root one", () => {
    const decision = runSelectAll({
      tree: treeOf(TODO_SCREEN),
      selectedLayerIds: [idOfClass(TODO_SCREEN, "label")],
      nonLayerIds: new Set(),
      fallback: "screens",
    });

    expect(decision.kind === "layers" && decision.layerIds).toEqual([
      idOfClass(TODO_SCREEN, "dot"),
      idOfClass(TODO_SCREEN, "label"),
      idOfClass(TODO_SCREEN, "check"),
    ]);
  });

  it("ignores a screen row and editor-internal ids as anchors", () => {
    const decision = runSelectAll({
      tree: treeOf(TODO_SCREEN),
      selectedLayerIds: ["__board__", "screen-1"],
      nonLayerIds: new Set(["screen-1"]),
      fallback: "screens",
    });

    expect(decision).toEqual({ kind: "screens" });
  });
});

describe("select-all with nothing selected", () => {
  it("selects every screen on the overview", () => {
    expect(
      runSelectAll({
        tree: treeOf(TODO_SCREEN),
        selectedLayerIds: [],
        nonLayerIds: new Set(),
        fallback: "screens",
      }),
    ).toEqual({ kind: "screens" });
  });

  it("selects the screen's root layers on a single screen", () => {
    const tree = treeOf(TODO_SCREEN);

    expect(
      runSelectAll({
        tree,
        selectedLayerIds: [],
        nonLayerIds: new Set(),
        fallback: "top-level-layers",
      }),
    ).toEqual({ kind: "layers", layerIds: tree.map((node) => node.id) });
  });

  it("falls back to screens when the screen has no layers at all", () => {
    expect(
      runSelectAll({
        tree: [],
        selectedLayerIds: [],
        nonLayerIds: new Set(),
        fallback: "top-level-layers",
      }),
    ).toEqual({ kind: "screens" });
  });
});
