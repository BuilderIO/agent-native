import { describe, expect, it } from "vitest";

import {
  applyVisualEdit,
  buildCodeLayerProjection,
  buildCodeLayerTree,
  ensureCodeLayerNodeIdsInHtml,
} from "./code-layer";

const X_IF = `<body x-data="{ open: false }">
  <section class="panel">
    <template x-if="open">
      <div class="advanced">
        <h3 class="title">API access tokens</h3>
        <button class="manage">Manage</button>
      </div>
    </template>
  </section>
</body>`;

const X_FOR = `<body x-data="app()">
  <ul class="list">
    <template x-for="t in todos" :key="t.text">
      <li class="row"><span class="label" x-text="t.text"></span></li>
    </template>
  </ul>
</body>`;

function project(html: string) {
  return buildCodeLayerProjection(html).nodes;
}

function treeNames(html: string): string[] {
  const tree = buildCodeLayerTree(buildCodeLayerProjection(html));
  const names: string[] = [];
  const walk = (nodes: typeof tree) => {
    for (const node of nodes) {
      names.push(`${node.type}:${node.tag}`);
      walk(node.children);
    }
  };
  walk(tree);
  return names;
}

describe("x-if content is reachable", () => {
  it("projects the body of a conditional", () => {
    const nodes = project(X_IF);

    expect(nodes.some((node) => node.classes.includes("advanced"))).toBe(true);
    expect(nodes.some((node) => node.classes.includes("title"))).toBe(true);
    expect(nodes.some((node) => node.classes.includes("manage"))).toBe(true);
  });

  it("gives the conditional's body a stable id so it can be edited", () => {
    const stamped = ensureCodeLayerNodeIdsInHtml(X_IF);
    const body = project(stamped.content).find((node) =>
      node.classes.includes("advanced"),
    );

    expect(body?.dataAttributes["data-agent-native-node-id"]).toBeTruthy();
  });
});

describe("x-for content is reachable", () => {
  it("projects the repeated body once, since source holds one copy", () => {
    const nodes = project(X_FOR);
    const rows = nodes.filter((node) => node.classes.includes("row"));

    expect(rows).toHaveLength(1);
    expect(nodes.some((node) => node.classes.includes("label"))).toBe(true);
  });
});

describe("opening templates does not open what is not markup", () => {
  it("still skips script, style and boxless void metadata", () => {
    const html = `<body><script>const a = 1;</script><style>.x{color:red}</style>
      <picture><source srcset="a.webp" /><img src="a.png" alt="a" /></picture></body>`;
    const tags = project(html).map((node) => node.tag);

    expect(tags).not.toContain("script");
    expect(tags).not.toContain("style");
    expect(tags).not.toContain("source");
  });

  it("does not add a row for the template element itself", () => {
    // A <template> measures 0x0 and both bridges refuse to select it, so a
    // row for one is a layer the canvas can never show.
    expect(treeNames(X_FOR)).not.toContain("frame:template");
    expect(treeNames(X_IF).some((name) => name.endsWith(":template"))).toBe(
      false,
    );
  });
});

describe("a move never lands inside a template's markup range", () => {
  const HTML = `<body data-agent-native-node-id="an-body">
  <ul data-agent-native-node-id="an-list">
    <template x-for="t in todos" data-agent-native-node-id="an-tpl"><li data-agent-native-node-id="an-row">x</li></template>
  </ul>
  <p data-agent-native-node-id="an-loose">move me</p>
</body>`;

  it("refuses or redirects rather than splicing into the repeat body", () => {
    const patch = applyVisualEdit(HTML, {
      kind: "moveNode",
      target: { nodeId: "an-loose" },
      anchor: { nodeId: "an-row" },
      placement: "inside",
    });

    if (patch.result.status === "applied") {
      // A redirect is acceptable; landing inside the template body is not.
      const tplStart = patch.content.indexOf(
        'data-agent-native-node-id="an-tpl"',
      );
      const tplEnd = patch.content.indexOf("</template>", tplStart);
      const moved = patch.content.indexOf(
        'data-agent-native-node-id="an-loose"',
      );
      expect(moved > tplStart && moved < tplEnd).toBe(false);
    }
  });

  it("refuses or redirects a move before a repeat body element", () => {
    const patch = applyVisualEdit(HTML, {
      kind: "moveNode",
      target: { nodeId: "an-loose" },
      anchor: { nodeId: "an-row" },
      placement: "before",
    });

    if (patch.result.status === "applied") {
      const tplStart = patch.content.indexOf(
        'data-agent-native-node-id="an-tpl"',
      );
      const tplEnd = patch.content.indexOf("</template>", tplStart);
      const moved = patch.content.indexOf(
        'data-agent-native-node-id="an-loose"',
      );
      expect(moved > tplStart && moved < tplEnd).toBe(false);
    }
  });
});
