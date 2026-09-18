import { expect, it } from "vitest";

import { applyVisualEdit, buildCodeLayerProjection } from "./code-layer.js";

function projectedStyle(html: string) {
  return buildCodeLayerProjection(html).nodes.find(
    (node) => node.dataAttributes["data-agent-native-node-id"] === "target",
  )?.style;
}

it("preserves quoted values, the cascade, custom-property case, and other declarations", () => {
  const html =
    `<div data-agent-native-node-id="target" style="/* keep */ ` +
    `background-image: url('data:image/svg+xml,first;second'); ` +
    `color: red; color: blue !important; width: 1px; width: 2px; ` +
    `height: 3px !important; height: 4px; --Theme: dark; --theme: light; ` +
    `border: 1px solid black">Target</div>`;
  const before = projectedStyle(html);

  const color = applyVisualEdit(html, {
    kind: "style",
    target: { nodeId: "target" },
    property: "color",
    value: "green",
  });
  const width = applyVisualEdit(color.content, {
    kind: "style",
    target: { nodeId: "target" },
    property: "width",
    value: "5px",
  });
  const height = applyVisualEdit(width.content, {
    kind: "style",
    target: { nodeId: "target" },
    property: "height",
    value: "6px",
  });
  const after = projectedStyle(height.content);

  expect(before).toMatchObject({
    "background-image": "url('data:image/svg+xml,first;second')",
    color: "blue !important",
    width: "2px",
    height: "3px !important",
    "--Theme": "dark",
    "--theme": "light",
    border: "1px solid black",
  });
  expect([
    color.result.status,
    width.result.status,
    height.result.status,
  ]).toEqual(["applied", "applied", "applied"]);
  expect(after).toMatchObject({
    "background-image": "url('data:image/svg+xml,first;second')",
    color: "green !important",
    width: "5px",
    height: "6px !important",
    "--Theme": "dark",
    "--theme": "light",
    border: "1px solid black",
  });
  expect(height.content).toContain("/* keep */");
  expect(height.content).toContain(
    "background-image: url('data:image/svg+xml,first;second')",
  );
  expect(height.content).toContain("width: 1px; width: 5px");
  expect(height.content).toContain("height: 6px !important; height: 4px");
});

it("diagnoses malformed inline CSS and refuses a write without changing HTML", () => {
  const html = `<div data-agent-native-node-id="target" style="color: 'red">Target</div>`;
  const projection = buildCodeLayerProjection(html);
  const patch = applyVisualEdit(html, {
    kind: "style",
    target: { nodeId: "target" },
    property: "color",
    value: "blue",
  });

  expect(projection.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "invalid-inline-style",
      severity: "warning",
    }),
  );
  expect(patch.result.status).toBe("unsupported");
  expect(patch.content).toBe(html);
});

it("diagnoses stylesheet rules inside inline CSS and refuses a write", () => {
  const html =
    `<div data-agent-native-node-id="target" ` +
    `style="color: red; .unexpected { color: blue }">Target</div>`;
  const projection = buildCodeLayerProjection(html);
  const patch = applyVisualEdit(html, {
    kind: "style",
    target: { nodeId: "target" },
    property: "color",
    value: "green",
  });

  expect(projection.diagnostics).toContainEqual(
    expect.objectContaining({ code: "invalid-inline-style" }),
  );
  expect(patch.result.status).toBe("unsupported");
  expect(patch.content).toBe(html);
});

it("removes duplicate inline declarations to restore stylesheet inheritance", () => {
  const html =
    `<style>.target { color: tomato; }</style>` +
    `<div data-agent-native-node-id="target" class="target" ` +
    `style="/* keep */ color: blue !important; color: green; ` +
    `width: 24px; --Theme: dark">Target</div>`;
  const patch = applyVisualEdit(html, {
    kind: "style",
    operation: "remove",
    target: { nodeId: "target" },
    property: "color",
  });

  expect(patch.result.status).toBe("applied");
  expect(patch.content).toContain("<style>.target { color: tomato; }</style>");
  expect(patch.content).toContain('class="target"');
  expect(patch.content).toContain("/* keep */");
  expect(patch.content).toContain("width: 24px");
  expect(patch.content).toContain("--Theme: dark");
  expect(patch.content).not.toContain("color: blue");
  expect(patch.content).not.toContain("color: green");
});

it("routes vector paint removal to the paint-owning shape", () => {
  const html =
    `<svg data-agent-native-node-id="target" data-an-primitive="path">` +
    `<path style="fill: blue; stroke: black" d="M0 0L1 1"/></svg>`;
  const patch = applyVisualEdit(html, {
    kind: "style",
    operation: "remove",
    target: { nodeId: "target" },
    property: "fill",
  });

  expect(patch.result.status).toBe("applied");
  expect(patch.content).not.toContain("fill: blue");
  expect(patch.content).toContain("stroke: black");
});

it("refuses virtual Boolean paint removal without changing the source", () => {
  const source =
    `<main><div data-agent-native-node-id="base" data-agent-native-layer-name="Base" data-an-primitive="rectangle" style="position:absolute;left:20px;top:30px;width:38px;height:38px;background-color:red"></div>` +
    `<div data-agent-native-node-id="cutter" data-agent-native-layer-name="Cutter" data-an-primitive="ellipse" style="position:absolute;left:31px;top:41px;width:16px;height:16px;background-color:blue"></div></main>`;
  const created = applyVisualEdit(source, {
    kind: "booleanSubtract",
    targetIds: ["base", "cutter"],
  });
  const html = created.content;
  expect(created.result.status).toBe("applied");
  const patch = applyVisualEdit(html, {
    kind: "style",
    operation: "remove",
    target: { nodeId: created.result.wrapperNodeId },
    property: "fill",
  });

  expect(patch.result.status).toBe("unsupported");
  expect(patch.content).toBe(html);
});
