import {
  buildCodeLayerProjection,
  clearCodeLayerProjectionCache,
} from "@shared/code-layer";
import { expect, it } from "vitest";

import {
  designFileCodeLayerSource,
  prepareCanonicalSourceContent,
  preparedSourceProjection,
  resolveSourceBaseForPublication,
} from "@/pages/design-editor/source-publication";

it("maps duplicate source IDs to the exact projected nodes after repair", () => {
  const content =
    '<main><button data-agent-native-node-id="shared">A</button><button data-agent-native-node-id="shared">B</button></main>';
  const source = { kind: "design-file" as const, fileId: "screen-a" };
  const before = buildCodeLayerProjection(content, { source });
  const prepared = prepareCanonicalSourceContent(content, {
    fileId: "screen-a",
    fileType: "html",
  });
  const after = buildCodeLayerProjection(prepared.content, { source });
  expect(prepared.changed).toBe(true);
  expect(
    new Set(
      after.nodes.map(
        (node) => node.dataAttributes["data-agent-native-node-id"],
      ),
    ).size,
  ).toBe(after.nodes.length);
  expect(after.nodes).toHaveLength(before.nodes.length);
  for (const [index, node] of before.nodes.entries()) {
    const target = after.nodes[index];
    expect(target?.tag).toBe(node.tag);
    expect(target?.textSnippet).toBe(node.textSnippet);
    expect(prepared.nodeIdMap.get(node.id)).toBe(target?.id);
  }
});

it.each([
  ["css", "body { color: red }"],
  ["jsx", "export default () => <main />"],
  ["html", "https://example.test/"],
])(
  "leaves non-HTML or URL-backed source unchanged (%s)",
  (fileType, content) => {
    expect(
      prepareCanonicalSourceContent(content, { fileId: "screen-a", fileType }),
    ).toEqual({ content, changed: false, nodeIdMap: new Map() });
  },
);

it("reuses canonical preparation for unchanged screen content", () => {
  const content =
    '<main data-agent-native-node-id="screen"><button data-agent-native-node-id="cta">Continue</button></main>';

  const first = prepareCanonicalSourceContent(content, {
    fileId: "unchanged-screen-cache",
    fileType: "html",
  });
  const second = prepareCanonicalSourceContent(content, {
    fileId: "unchanged-screen-cache",
    fileType: "html",
  });

  expect(second).toBe(first);
});

it("does not retain an oversized screen in the canonical cache", () => {
  const content = `<main data-agent-native-node-id="screen">${" ".repeat(256 * 1024)}<button data-agent-native-node-id="cta">Continue</button></main>`;

  const first = prepareCanonicalSourceContent(content, {
    fileId: "oversized-screen-cache",
    fileType: "html",
  });
  const second = prepareCanonicalSourceContent(content, {
    fileId: "oversized-screen-cache",
    fileType: "html",
  });

  expect(second).not.toBe(first);
});

it("bounds canonical cache retention by UTF-8 bytes", () => {
  const content = `<main data-agent-native-node-id="screen">${"😀".repeat(70_000)}</main>`;

  const first = prepareCanonicalSourceContent(content, {
    fileId: "unicode-screen-cache",
    fileType: "html",
  });
  const second = prepareCanonicalSourceContent(content, {
    fileId: "unicode-screen-cache",
    fileType: "html",
  });

  expect(second).not.toBe(first);
});

it("keeps a whole design cached across repeated prepare passes", () => {
  const screens = Array.from({ length: 100 }, (_, index) => ({
    fileId: `whole-design-${index}`,
    content: `<main data-agent-native-node-id="screen-${index}">${"x".repeat(200_000)}</main>`,
  }));
  const first = screens.map(({ fileId, content }) =>
    prepareCanonicalSourceContent(content, { fileId, fileType: "html" }),
  );
  const second = screens.map(({ fileId, content }) =>
    prepareCanonicalSourceContent(content, { fileId, fileType: "html" }),
  );
  second.forEach((result, index) => expect(result).toBe(first[index]));
});

it("bounds unchanged canonical entries by count", () => {
  const prepare = (index: number) =>
    prepareCanonicalSourceContent(
      `<main data-agent-native-node-id="screen-${index}"></main>`,
      { fileId: `count-bound-${index}`, fileType: "html" },
    );
  const first = prepare(0);
  for (let index = 1; index <= 4096; index += 1) prepare(index);
  expect(prepare(0)).not.toBe(first);
});

it("maps an already-canonical screen's nodes to themselves", () => {
  const content =
    '<main data-agent-native-node-id="screen"><button data-agent-native-node-id="cta">Continue</button></main>';
  const prepared = prepareCanonicalSourceContent(content, {
    fileId: "canonical-identity",
    fileType: "html",
  });
  const ids = buildCodeLayerProjection(content, {
    source: { kind: "design-file", fileId: "canonical-identity" },
  }).nodes.map((node) => node.id);

  expect(prepared.changed).toBe(false);
  expect(prepared.content).toBe(content);
  expect(prepared.nodeIdMap).toEqual(new Map(ids.map((id) => [id, id])));
});

it("keeps an identity migration's raw bytes as the CAS base for a follow-up edit", () => {
  const raw = "<main><button>Listen now</button></main>";
  const canonical = prepareCanonicalSourceContent(raw, {
    fileId: "screen-a",
    fileType: "html",
  }).content;

  expect(canonical).not.toBe(raw);
  expect(
    resolveSourceBaseForPublication({
      fileId: "screen-a",
      fileType: "html",
      pending: {
        content: canonical,
        identityMigrationSourceContent: raw,
      },
      collabContent: raw,
      persistedContent: raw,
      beforeContent: canonical,
    }),
  ).toBe(raw);
});

it("uses canonical pending bytes once identity migration is durable", () => {
  const raw = "<main><button>Listen now</button></main>";
  const canonical = prepareCanonicalSourceContent(raw, {
    fileId: "screen-a",
    fileType: "html",
  }).content;

  expect(
    resolveSourceBaseForPublication({
      fileId: "screen-a",
      fileType: "html",
      pending: {
        content: canonical,
        identityMigrationSourceContent: raw,
      },
      persistedContent: canonical,
      beforeContent: canonical,
    }),
  ).toBe(canonical);
});

it("hands the Layers model the projection it built for the editor's source", () => {
  const content =
    '<main data-agent-native-node-id="screen"><p>Hi</p><p>There</p></main>';
  const source = designFileCodeLayerSource(
    "design-1",
    "reuse-screen",
    "a.html",
  );
  const prepared = prepareCanonicalSourceContent(content, {
    fileId: "reuse-screen",
    fileType: "html",
    source,
  });
  expect(prepared.changed).toBe(true);

  const reused = preparedSourceProjection("reuse-screen", prepared.content, {
    ...source,
  });
  clearCodeLayerProjectionCache();
  const fresh = buildCodeLayerProjection(prepared.content, { source });
  expect(reused).toBeDefined();
  expect(reused).not.toBe(fresh);
  expect(reused).toEqual(fresh);
  expect([...prepared.nodeIdMap.values()]).toEqual(
    fresh.nodes.map((node) => node.id),
  );

  expect(
    preparedSourceProjection("reuse-screen", content, source),
  ).toBeUndefined();
  expect(
    preparedSourceProjection(
      "reuse-screen",
      prepared.content,
      designFileCodeLayerSource("design-1", "reuse-screen", "renamed.html"),
    ),
  ).toBeUndefined();
});

it("refuses a projection source that names another file", () => {
  expect(() =>
    prepareCanonicalSourceContent("<main><p>x</p></main>", {
      fileId: "screen-a",
      fileType: "html",
      source: designFileCodeLayerSource("design-1", "screen-b", undefined),
    }),
  ).toThrow("same file");
});
