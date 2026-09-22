import { buildCodeLayerProjection } from "@shared/code-layer";
import { expect, it } from "vitest";

import {
  prepareCanonicalSourceContent,
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
  const content = `<main data-agent-native-node-id="screen">${"😀".repeat(60_000)}</main>`;

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
