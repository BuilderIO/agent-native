import { describe, expect, it } from "vitest";

import { buildCodeLayerProjection } from "./code-layer";

const SCREEN = `<body>
  <ul>
    <template x-for="todo in todos" :key="todo.text">
      <li class="row"><span class="label" x-text="todo.text"></span></li>
    </template>
    <li class="static">+ Add a task</li>
  </ul>
  <div>
    <template x-for="column in columns">
      <div class="col"><template x-for="card in column.cards"><p class="card" x-text="card.title"></p></template></div>
    </template>
  </div>
</body>`;

function repeatOf(className: string): string | null {
  const node = buildCodeLayerProjection(SCREEN).nodes.find((candidate) =>
    candidate.classes.includes(className),
  );
  if (!node) throw new Error(`no node with class ${className}`);
  return node.repeatXFor;
}

describe("which repeat renders a node", () => {
  it("names the repeat for a row and its descendants", () => {
    expect(repeatOf("row")).toBe("todo in todos");
    expect(repeatOf("label")).toBe("todo in todos");
  });

  it("leaves a static sibling out of it", () => {
    expect(repeatOf("static")).toBeNull();
  });

  it("names the nearest repeat inside a nested one", () => {
    expect(repeatOf("col")).toBe("column in columns");
    expect(repeatOf("card")).toBe("card in column.cards");
  });
});
