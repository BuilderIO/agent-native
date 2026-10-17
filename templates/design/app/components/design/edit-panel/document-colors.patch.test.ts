import { buildCodeLayerProjection } from "@shared/code-layer";
import { beforeAll, describe, expect, it, vi } from "vitest";

import * as patched from "./document-colors";

type DocumentColors = typeof patched;

const FIXTURE = [
  "<!doctype html><html><head>",
  "<style>.card { background: #fafafa; color: rgb(10, 20, 30); } /* #ff0000 */</style>",
  '<style data-agent-native-breakpoints>@media (max-width: 600px) { [data-agent-native-node-id="title"] { color: #0f172a; } }</style>',
  "<script>const markup = '<div style=\"color:#00ff00\">';</script>",
  "</head><body>",
  '<!-- <div style="color:#123123"></div> -->',
  '<section data-agent-native-node-id="hero" style="background-color: #1d4ed8; color: #ffffff; border: 1px solid rgba(0, 0, 0, 0.1)">',
  '<h1 data-agent-native-node-id="title" style="color:#f97316" x-show="count > 1">Hero title</h1>',
  '<p data-agent-native-node-id="copy" class="text-sm">Plain copy with a < sign<b style="color:#654321">bold</b></p>',
  '<svg data-an-primitive="pasted-svg" viewBox="0 0 24 24" fill="#111111"><g data-agent-native-node-id="group"><path data-agent-native-node-id="path" fill="#22c55e" stroke="#15803d" d="M0 0h24v24z"/></g></svg>',
  "</section>",
  '<aside data-agent-native-node-id="aside" style="color:#f97316; background:hsl(210, 50%, 50%)"><img src="x.png" style="outline-color:#a855f7"/></aside>',
  '<scrip data-agent-native-node-id="scrip" style="color:#777777">x</scrip>',
  "</body></html>",
].join("\n");

const NODE_IDS = ["hero", "title", "copy", "group", "path", "aside", "scrip"];

let fresh: DocumentColors;
let freshReads = 0;

beforeAll(async () => {
  vi.resetModules();
  fresh = await import("./document-colors");
});

function colorReads(
  colors: DocumentColors,
  fileId: string,
  content: string,
): unknown {
  const counts = [
    ...colors.documentFileColorCounts({ id: fileId, content }, new Map()),
  ];
  const wholeDocument = [{ fileId, content, wholeDocument: true }];
  const documentColors = colors.selectionColorValues([], wholeDocument);
  const hasNode = new Set(
    buildCodeLayerProjection(content).nodes.map(
      (node) => node.dataAttributes["data-agent-native-node-id"],
    ),
  );
  return {
    counts,
    documentColors,
    nodeColors: NODE_IDS.filter((id) => hasNode.has(id)).map((sourceId) =>
      colors.selectionColorValues([], [{ fileId, content, sourceId }]),
    ),
    replaced: documentColors
      .slice(0, 2)
      .map(({ value }) =>
        colors.replaceSelectionColorsInHtml(
          content,
          wholeDocument,
          value,
          "#abcdef",
        ),
      ),
  };
}

function patchedReadsMatchFullScan(fileId: string, content: string): string {
  const before = patched._colorTokenScanCountsForTests();
  const actual = colorReads(patched, fileId, content);
  const after = patched._colorTokenScanCountsForTests();
  freshReads += 1;
  expect(actual).toEqual(colorReads(fresh, `full-${freshReads}`, content));
  return after.patched > before.patched ? "patched" : "full";
}

describe("patched color token scans", () => {
  it("match a full scan after attribute, text, SVG, and style-block edits", () => {
    const edits: Array<[string, string]> = [
      ['style="color:#f97316"', 'style="color:#f97317"'],
      ['style="color:#f97317"', 'style="color:rgb(1, 2, 3)"'],
      ["Hero title", "Hero headline"],
      ['class="text-sm"', 'class="text-sm" style="color:#0ea5e9"'],
      ["color:#0ea5e9", "color:#0ea5e8"],
      ['fill="#22c55e"', 'fill="#16a34a"'],
      ["color: #0f172a", "color: #334155"],
      ["background: #fafafa", "background: #fefefe"],
      ['x-show="count > 1"', 'x-show="count >> 1"'],
      ["<style>", '<style media="screen">'],
      [".card {", "b{color:#0000aa}.card {"],
      ["*/</style>", "*/b{color:#0000bb}</style>"],
      ["color:#00ff00", "color:#00ff01"],
      ["color:#123123", "color:#123124"],
      ["</aside>", '<span style="color:#e11d48">new</span></aside>'],
      ['x-show="count >> 1"', 'x-show=count >> 1"'],
      ['screen">b{color:#0000aa}', 'screan">b{color:#0000ab}'],
      ['<img src="x.png"', 'img src="x.png"'],
      ["a < sign", "a <sign"],
      ["<scrip data", "<script data"],
      ['fill="#111111">', 'fill="#111111"/>'],
      ["<!doctype html>", "<!--doctype html>"],
    ];
    const fileId = "scripted";
    let content = FIXTURE;
    patchedReadsMatchFullScan(fileId, content);
    const paths = edits.map(([from, to]) => {
      expect(content).toContain(from);
      content = content.replace(from, to);
      return patchedReadsMatchFullScan(fileId, content);
    });

    expect(paths).toEqual([
      "patched",
      "patched",
      "patched",
      "patched",
      "patched",
      "patched",
      "patched",
      "patched",
      "patched",
      "patched",
      "patched",
      "patched",
      "full",
      "full",
      "full",
      "full",
      "full",
      "full",
      "full",
      "full",
      "full",
      "full",
    ]);
  });

  it("keep later comment and unterminated-tag regions aligned after an edit", () => {
    const fileId = "shifted-regions";
    let content =
      '<p style="color:#111111">Long text here</p><!-- <b style="color:#222222"> --><div style="color:#333333"></div><div class="x';
    patchedReadsMatchFullScan(fileId, content);
    const paths = (
      [
        ["Long text here", "Text"],
        ['<div class="x', '<div style="color:#444444">class="x'],
        ["Text", "Long text here"],
        [" -->", " --x>"],
      ] as const
    ).map(([from, to]) => {
      content = content.replace(from, to);
      return patchedReadsMatchFullScan(fileId, content);
    });

    expect(paths).toEqual(["patched", "full", "patched", "full"]);
  });

  it("match a full scan when style-block text reads as markup", () => {
    const fileId = "markup-in-css";
    let content = [
      "<style>.quote::after { content: \"<b style='color:#abcabc'>\"; color: #0000ff; }</style>",
      '<div data-agent-native-node-id="box" style="color:#123456"></div>',
    ].join("");
    patchedReadsMatchFullScan(fileId, content);
    content = content.replace("color: #0000ff", "color: #0000fe");
    expect(patchedReadsMatchFullScan(fileId, content)).toBe("full");
    content = content.replace("color:#123456", "color:#123457");
    expect(patchedReadsMatchFullScan(fileId, content)).toBe("full");
  });

  it("match a full scan after random edits, including malformed markup", () => {
    const alphabet = ["a", " ", '"', "'", "<", ">", "/", "-", "!", "#", "f"];
    alphabet.push("0", ";", ":", "=", "s", "v", "g", "\n", "*", "(");
    const fileId = "random";
    let seed = 7;
    const pick = (limit: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return (seed >>> 16) % limit;
    };
    let content = FIXTURE;
    let patchedEdits = 0;
    patchedReadsMatchFullScan(fileId, content);
    for (let step = 0; step < 400; step += 1) {
      if (step % 40 === 0) content = FIXTURE;
      const start = pick(content.length + 1);
      const removed = pick(4);
      let inserted = "";
      for (let count = pick(5); count > 0; count -= 1) {
        inserted += alphabet[pick(alphabet.length)];
      }
      content = `${content.slice(0, start)}${inserted}${content.slice(start + removed)}`;
      if (patchedReadsMatchFullScan(fileId, content) === "patched") {
        patchedEdits += 1;
      }
    }

    expect(patchedEdits).toBeGreaterThan(50);
    expect(fresh._colorTokenScanCountsForTests().patched).toBe(0);
  });

  it("does not rescan the whole screen after a style edit", () => {
    const fileId = "no-rescan";
    const cache = new Map();
    patched.documentFileColorCounts({ id: fileId, content: FIXTURE }, cache);
    const before = patched._colorTokenScanCountsForTests();
    const edited = FIXTURE.replace(
      'style="color:#f97316"',
      'style="color:#0f172a"',
    );

    expect(
      patched.selectionColorValues(
        [],
        [{ fileId, content: edited, sourceId: "title" }],
      ),
    ).toEqual([{ property: "color", value: "#0f172a" }]);
    expect([
      ...patched.documentFileColorCounts(
        { id: fileId, content: edited },
        cache,
      ),
    ]).toContainEqual(["#0F172A", 2]);
    expect(patched._colorTokenScanCountsForTests()).toEqual({
      full: before.full,
      patched: before.patched + 1,
    });
  });
});
