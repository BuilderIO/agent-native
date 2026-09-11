import { describe, expect, it } from "vitest";

import {
  applyVisualEdit,
  buildCodeLayerProjection,
  ensureCodeLayerNodeIdsInHtml,
} from "./code-layer";

/** Design 2's todo list: a repeat body plus a static sibling row. */
const TODO_LIST = `<body>
  <ul data-agent-native-node-id="an-list">
    <template x-for="todo in todos" :key="todo.text">
      <li data-agent-native-node-id="an-row" class="row"><span x-text="todo.text"></span></li>
    </template>
    <li data-agent-native-node-id="an-static" class="static">+ Add a task</li>
  </ul>
</body>`;

function templateInterior(html: string): string {
  const open = html.indexOf("<template");
  return html.slice(open, html.indexOf("</template>", open));
}

describe("styling one repeated row", () => {
  it("lands the style inside the template body, not on the static sibling", () => {
    const patch = applyVisualEdit(TODO_LIST, {
      kind: "style",
      target: { selector: '[data-agent-native-node-id="an-row"]' },
      property: "backgroundColor",
      value: "rgb(1, 2, 3)",
    });

    expect(patch.result.status).toBe("applied");
    expect(templateInterior(patch.content)).toContain("rgb(1, 2, 3)");
    const staticRow = patch.content.slice(
      patch.content.indexOf('data-agent-native-node-id="an-static"'),
    );
    expect(staticRow).not.toContain("rgb(1, 2, 3)");
  });

  it("writes once, so every rendered row reads the same declaration", () => {
    const patch = applyVisualEdit(TODO_LIST, {
      kind: "style",
      target: { selector: '[data-agent-native-node-id="an-row"]' },
      property: "backgroundColor",
      value: "rgb(1, 2, 3)",
    });

    expect(patch.content.split("rgb(1, 2, 3)")).toHaveLength(2);
  });

  it("keeps the repeat's own binding intact", () => {
    const patch = applyVisualEdit(TODO_LIST, {
      kind: "style",
      target: { selector: '[data-agent-native-node-id="an-row"]' },
      property: "paddingLeft",
      value: "12px",
    });

    expect(patch.content).toContain('x-for="todo in todos"');
    expect(patch.content).toContain('x-text="todo.text"');
  });

  it("resolves the template body on a freshly stamped document too", () => {
    const unstamped = `<body>
  <ul>
    <template x-for="todo in todos"><li class="row">x</li></template>
    <li class="static">+ Add a task</li>
  </ul>
</body>`;
    const stamped = ensureCodeLayerNodeIdsInHtml(unstamped).content;
    const rowId = buildCodeLayerProjection(stamped).nodes.find((node) =>
      node.classes.includes("row"),
    )?.dataAttributes["data-agent-native-node-id"];
    expect(rowId).toBeTruthy();

    const patch = applyVisualEdit(stamped, {
      kind: "style",
      target: { selector: `[data-agent-native-node-id="${rowId}"]` },
      property: "backgroundColor",
      value: "rgb(4, 5, 6)",
    });

    expect(patch.result.status).toBe("applied");
    expect(templateInterior(patch.content)).toContain("rgb(4, 5, 6)");
  });
});
