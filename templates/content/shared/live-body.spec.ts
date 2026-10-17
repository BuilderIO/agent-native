// @vitest-environment happy-dom

import { getSchema } from "@tiptap/core";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { describe, expect, it } from "vitest";
import { XmlElement, XmlText } from "yjs";

import { createVisualEditorExtensions } from "../app/components/editor/VisualEditor.js";
import {
  compareLiveBody,
  describeLiveBodyMismatch,
  LIVE_BODY_FIELD,
  materializeLiveBody,
} from "./live-body.js";
import { docToNfm, nfmToDoc } from "./nfm.js";

const editorSchema = getSchema(createVisualEditorExtensions());

/** What the editor shows for `markdown`, bound to a live copy. */
function editorPage(markdown: string) {
  const json = editorSchema.nodeFromJSON(nfmToDoc(markdown)).toJSON();
  const ydoc = prosemirrorJSONToYDoc(editorSchema, json, LIVE_BODY_FIELD);
  // The browser saves `docToNfm(editor.getJSON())`.
  return { ydoc, saved: docToNfm(json) };
}

const BODIES: Array<[string, string]> = [
  ["paragraphs", "Alpha paragraph\nBravo paragraph"],
  [
    "marks",
    'Text with **bold**, *italic*, ~~strike~~, `code`, [link](https://example.com), $x^2$, a<br>break, and <span underline="true" color="red">styled</span>.',
  ],
  ["heading with color", '# Heading {color="blue"}\nBody'],
  ["lists", "- bullet\n\t- nested\n1. ordered\n- [x] done\n- [ ] open"],
  ["quote and divider", "> Quote\n---\nAfter"],
  ["code", "```ts\nconst answer = 42;\n```"],
  [
    "media",
    '![Cover](https://example.com/cover.png)\n<video src="https://example.com/video.mp4" controls></video>\n<audio src="https://example.com/audio.mp3" controls></audio>',
  ],
  [
    "containers",
    '<details summary="More">\n\tToggle body\n</details>\n<callout icon="💡">\n\tCallout body\n</callout>\n<columns>\n\t<column>\n\t\tColumn body\n\t</column>\n</columns>',
  ],
  [
    "table",
    '<table header-row="true">\n\t<tr>\n\t\t<th>Header</th>\n\t</tr>\n\t<tr>\n\t\t<td>Cell</td>\n\t</tr>\n</table>',
  ],
  [
    "atoms",
    '<page url="https://example.com/page">Page</page>\n<Endpoint id="endpoint-1" method="GET" path="/api/items" />\n<UnknownLocalComponent label="Preserved" />',
  ],
  ["empty", ""],
];

describe("materializeLiveBody", () => {
  for (const [name, markdown] of BODIES) {
    it(`builds what the editor saves: ${name}`, () => {
      const { ydoc, saved } = editorPage(markdown);
      expect(materializeLiveBody(ydoc)).toMatchObject({
        kind: "body",
        markdown: saved,
      });
    });
  }

  it("reports a body that loses content the schema rejects as lossy, not shorter", () => {
    const { ydoc } = editorPage("Alpha paragraph");
    const unknown = new XmlElement("notAContentNode");
    const text = new XmlText();
    text.insert(0, "must survive");
    unknown.insert(0, [text]);
    ydoc.getXmlFragment(LIVE_BODY_FIELD).insert(1, [unknown]);
    expect(materializeLiveBody(ydoc).kind).toBe("lossy");
  });

  it("reports a live copy no editor has bound as uninitialized, not empty", () => {
    const { ydoc } = editorPage("");
    ydoc.getXmlFragment(LIVE_BODY_FIELD).delete(0, 1);
    expect(materializeLiveBody(ydoc).kind).toBe("uninitialized");
  });
});

describe("compareLiveBody", () => {
  it("matches the body the editor saves", () => {
    const { ydoc, saved } = editorPage("Alpha paragraph");
    expect(compareLiveBody(materializeLiveBody(ydoc), saved)).toBe("match");
  });

  it("treats Markdown that reads back the same as equivalent", () => {
    const { ydoc } = editorPage("Alpha paragraph\nBravo paragraph");
    expect(
      compareLiveBody(
        materializeLiveBody(ydoc),
        "Alpha paragraph\r\nBravo paragraph\n",
      ),
    ).toBe("equivalent");
  });

  it("flags a different body and says where it starts", () => {
    const { ydoc } = editorPage("Alpha paragraph");
    const live = materializeLiveBody(ydoc);
    expect(compareLiveBody(live, "Alpha")).toBe("mismatch");
    if (live.kind !== "body") throw new Error("expected a body");
    expect(describeLiveBodyMismatch(live, "Alpha")).toEqual({
      block: 0,
      liveBlockType: "paragraph",
      savedBlockType: "paragraph",
      at: 5,
    });
  });

  it("locates a mismatch by what each block saves, not by attributes Markdown drops", () => {
    const json = editorSchema
      .nodeFromJSON(
        nfmToDoc("![Cover](https://example.com/cover.png)\nAlpha paragraph"),
      )
      .toJSON();
    json.content[0].attrs = { ...json.content[0].attrs, width: 320 };
    const ydoc = prosemirrorJSONToYDoc(editorSchema, json, LIVE_BODY_FIELD);
    const live = materializeLiveBody(ydoc);
    if (live.kind !== "body") throw new Error("expected a body");
    const saved = live.markdown.replace("Alpha paragraph", "Alpha");
    expect(compareLiveBody(live, saved)).toBe("mismatch");
    expect(describeLiveBodyMismatch(live, saved)).toMatchObject({
      block: 1,
      liveBlockType: "paragraph",
      savedBlockType: "paragraph",
    });
  });

  it("does not compare against a live copy it could not build", () => {
    expect(compareLiveBody({ kind: "lossy" }, "Alpha")).toBe("lossy");
    expect(compareLiveBody({ kind: "uninitialized" }, "")).toBe(
      "uninitialized",
    );
  });
});
