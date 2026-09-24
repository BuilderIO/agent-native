import {
  applyVisualEdit,
  buildCodeLayerProjection,
  buildCodeLayerTree,
  ensureCodeLayerNodeIdsInHtml,
  moveNodeBetweenDocuments,
} from "@shared/code-layer";
import { describe, expect, it } from "vitest";

import {
  collectCodeLayerAncestors,
  findCodeLayerSiblingOrder,
} from "./code-layer-state";

const ALPINE_PILOT_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Alpine design pilot</title>
  </head>
  <body>
    <main data-agent-native-layer-name="App shell" x-data="{ open: true, count: 0 }">
      <nav data-agent-native-layer-name="Actions">
        <button data-agent-native-layer-name="Primary action" @click="count++" :class="{ 'is-active': count > 0 }">Create</button>
        <button data-agent-native-layer-name="Secondary action" @click="open = !open">Toggle</button>
      </nav>
      <section data-agent-native-layer-name="Card" x-show="open">
        <h2 data-agent-native-layer-name="Card title">Project alpha</h2>
        <p data-agent-native-layer-name="Card body" x-text="\`Count: \${count}\`">Count: 0</p>
      </section>
      <section data-agent-native-layer-name="Drop zone"></section>
      <div data-agent-native-layer-name="Floating badge" style="position: absolute; left: 24px; top: 32px; color: rgb(12, 18, 28)">New</div>
    </main>
    <script src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js" defer></script>
  </body>
</html>`;

function nodeByName(html: string, name: string) {
  const node = buildCodeLayerProjection(html).nodes.find(
    (candidate) => candidate.layerName === name,
  );
  expect(node, `expected layer named ${name}`).toBeTruthy();
  return node!;
}

function attrIdByName(html: string, name: string) {
  const id = nodeByName(html, name).dataAttributes["data-agent-native-node-id"];
  expect(id, `expected stable id for ${name}`).toBeTruthy();
  return id!;
}

function latest(items: readonly string[]) {
  return items[items.length - 1]!;
}

describe("net-new HTML/Alpine visual-edit pilot", () => {
  it("keeps every source-backed layer selectable and stable through edits, reparenting, auto layout, reload, undo, and redo", () => {
    const stamped = ensureCodeLayerNodeIdsInHtml(ALPINE_PILOT_HTML);
    expect(stamped.changed).toBe(true);

    const initialProjection = buildCodeLayerProjection(stamped.content);
    const meaningfulTags = initialProjection.nodes
      .filter((node) => node.tag !== "html" && node.tag !== "body")
      .map((node) => node.tag);
    expect(meaningfulTags).toEqual([
      "main",
      "nav",
      "button",
      "button",
      "section",
      "h2",
      "p",
      "section",
      "div",
    ]);
    expect(
      new Set(
        initialProjection.nodes.map(
          (node) => node.dataAttributes["data-agent-native-node-id"],
        ),
      ).size,
    ).toBe(initialProjection.nodes.length);

    const initialTree = buildCodeLayerTree(initialProjection);
    const primary = nodeByName(stamped.content, "Primary action");
    const secondary = nodeByName(stamped.content, "Secondary action");
    const actions = nodeByName(stamped.content, "Actions");
    expect(findCodeLayerSiblingOrder(initialTree, primary.id)).toMatchObject({
      siblingIds: [primary.id, secondary.id],
      index: 0,
      parentId: actions.id,
    });
    expect(collectCodeLayerAncestors(initialTree, primary.id)).toEqual([
      nodeByName(stamped.content, "App shell").id,
      actions.id,
    ]);

    const stableIds = Object.fromEntries(
      initialProjection.nodes.map((node) => [
        node.layerName,
        node.dataAttributes["data-agent-native-node-id"],
      ]),
    );
    const history = [stamped.content];

    const styleEdit = applyVisualEdit(latest(history), {
      kind: "style",
      target: { nodeId: attrIdByName(latest(history), "Card") },
      property: "background-color",
      value: "rgb(250, 250, 252)",
    });
    expect(styleEdit.result.status).toBe("applied");
    history.push(styleEdit.content);

    const textEdit = applyVisualEdit(latest(history), {
      kind: "textContent",
      target: { nodeId: attrIdByName(latest(history), "Card title") },
      value: "Project beta",
    });
    expect(textEdit.result.status).toBe("applied");
    history.push(textEdit.content);

    const autoLayoutEdit = applyVisualEdit(latest(history), {
      kind: "autoLayout",
      targetId: attrIdByName(latest(history), "Drop zone"),
      enabled: true,
      direction: "row",
      gap: "12px",
    });
    expect(autoLayoutEdit.result.status).toBe("applied");
    history.push(autoLayoutEdit.content);

    const reparentEdit = applyVisualEdit(latest(history), {
      kind: "moveNode",
      target: { nodeId: attrIdByName(latest(history), "Floating badge") },
      anchor: { nodeId: attrIdByName(latest(history), "Drop zone") },
      placement: "inside",
    });
    expect(reparentEdit.result.status).toBe("applied");
    history.push(reparentEdit.content);

    const badgeAfterReparent = nodeByName(latest(history), "Floating badge");
    const dropZoneAfterReparent = nodeByName(latest(history), "Drop zone");
    expect(badgeAfterReparent.parentId).toBe(dropZoneAfterReparent.id);
    expect(badgeAfterReparent.style.position).toBeUndefined();
    expect(badgeAfterReparent.style.left).toBeUndefined();
    expect(badgeAfterReparent.style.top).toBeUndefined();
    expect(dropZoneAfterReparent.layout.isFlexContainer).toBe(true);
    expect(dropZoneAfterReparent.layout.flexDirection).toBe("row");
    expect(dropZoneAfterReparent.layout.gap).toBe("12px");

    const reorderEdit = applyVisualEdit(latest(history), {
      kind: "moveNode",
      target: { nodeId: attrIdByName(latest(history), "Secondary action") },
      anchor: { nodeId: attrIdByName(latest(history), "Primary action") },
      placement: "before",
    });
    expect(reorderEdit.result.status).toBe("applied");
    history.push(reorderEdit.content);

    const reloadedProjection = buildCodeLayerProjection(latest(history));
    for (const node of reloadedProjection.nodes) {
      expect(node.dataAttributes["data-agent-native-node-id"]).toBe(
        stableIds[node.layerName],
      );
    }
    expect(latest(history)).toContain('x-data="{ open: true, count: 0 }"');
    expect(latest(history)).toContain('x-show="open"');
    expect(latest(history)).toContain('@click="count++"');
    expect(latest(history)).toContain(":class=\"{ 'is-active': count > 0 }\"");
    expect(latest(history)).toContain('x-text="`Count: ${count}`"');

    const finalTree = buildCodeLayerTree(reloadedProjection);
    const finalSecondary = nodeByName(latest(history), "Secondary action");
    const finalPrimary = nodeByName(latest(history), "Primary action");
    expect(
      findCodeLayerSiblingOrder(finalTree, finalSecondary.id),
    ).toMatchObject({
      siblingIds: [finalSecondary.id, finalPrimary.id],
      index: 0,
    });

    // The editor history stores full source snapshots. Undo and redo must
    // therefore restore both structure and Alpine directives byte-for-byte.
    const undoSnapshot = history[history.length - 2]!;
    expect(undoSnapshot).toBe(reparentEdit.content);
    const redoSnapshot = latest(history);
    expect(redoSnapshot).toBe(reorderEdit.content);
    expect(buildCodeLayerProjection(undoSnapshot).nodes).toHaveLength(
      reloadedProjection.nodes.length,
    );
    expect(buildCodeLayerProjection(redoSnapshot).nodes).toHaveLength(
      reloadedProjection.nodes.length,
    );
  });

  it("puts a cross-screen drop into destination auto-layout flow without damaging Alpine directives", () => {
    const source = ensureCodeLayerNodeIdsInHtml(
      `<main><div data-agent-native-layer-name="Movable" x-data="{ enabled: true }" x-show="enabled" class="absolute md:!fixed left-20 top-10 rounded" style="position: absolute; left: 80px; top: 40px">Move me</div></main>`,
    ).content;
    const destination = ensureCodeLayerNodeIdsInHtml(
      `<main><section data-agent-native-layer-name="Destination" style="display: flex; flex-direction: column; gap: 8px"><button @click="saved = true">Existing</button></section></main>`,
    ).content;

    const result = moveNodeBetweenDocuments(source, destination, {
      nodeId: attrIdByName(source, "Movable"),
      anchorNodeId: attrIdByName(destination, "Existing"),
      placement: "before",
    });

    expect(result.status).toBe("applied");
    expect(result.sourceHtml).not.toContain("Move me");
    expect(result.destHtml).toContain('x-data="{ enabled: true }"');
    expect(result.destHtml).toContain('x-show="enabled"');
    expect(result.destHtml).toContain('@click="saved = true"');
    const moved = nodeByName(result.destHtml, "Movable");
    expect(moved.style.position).toBeUndefined();
    expect(moved.style.left).toBeUndefined();
    expect(moved.style.top).toBeUndefined();
    expect(moved.classes).toEqual(["left-20", "top-10", "rounded"]);
    expect(moved.parentId).toBe(nodeByName(result.destHtml, "Destination").id);
  });

  it("preserves an intentional absolute Auto layout child while reordering siblings", () => {
    const html = ensureCodeLayerNodeIdsInHtml(
      `<section data-agent-native-layer-name="Layout" style="display: flex; gap: 8px"><div data-agent-native-layer-name="Pinned" style="position: absolute; right: 4px; top: 4px">Pinned</div><div data-agent-native-layer-name="Flow child">Flow</div></section>`,
    ).content;

    const reordered = applyVisualEdit(html, {
      kind: "moveNode",
      target: { nodeId: attrIdByName(html, "Pinned") },
      anchor: { nodeId: attrIdByName(html, "Flow child") },
      placement: "after",
    });

    expect(reordered.result.status).toBe("applied");
    const pinned = nodeByName(reordered.content, "Pinned");
    expect(pinned.style.position).toBe("absolute");
    expect(pinned.style.right).toBe("4px");
    expect(pinned.style.top).toBe("4px");
  });
});
