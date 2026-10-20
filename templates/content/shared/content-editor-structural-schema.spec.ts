// @vitest-environment happy-dom

import { getSchema } from "@tiptap/core";
import {
  prosemirrorJSONToYXmlFragment,
  yDocToProsemirrorJSON,
} from "@tiptap/y-tiptap";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createVisualEditorExtensions } from "../app/components/editor/VisualEditor.js";
import { createContentEditorStructuralSchema } from "./content-editor-structural-schema.js";
import { nfmToDoc, type PMNode } from "./nfm.js";

const NODE_FIELDS = [
  "content",
  "marks",
  "group",
  "inline",
  "atom",
  "selectable",
  "draggable",
  "code",
  "whitespace",
  "defining",
  "definingAsContext",
  "definingForContent",
  "isolating",
  "linebreakReplacement",
] as const;

const MARK_FIELDS = [
  "inclusive",
  "excludes",
  "group",
  "spanning",
  "code",
] as const;

function structuralSchemaSnapshot() {
  const schema = getSchema(createVisualEditorExtensions());
  function types(
    collection: typeof schema.nodes | typeof schema.marks,
    fields: readonly string[],
  ) {
    return Object.values(collection).map((type) => {
      const spec = type.spec as Record<string, unknown>;
      const attrs = Object.entries(
        (spec.attrs ?? {}) as Record<
          string,
          { default?: unknown; validate?: unknown }
        >,
      ).map(([name, attribute]) => {
        if (
          attribute.validate !== undefined &&
          typeof attribute.validate !== "string"
        ) {
          throw new Error(
            `${type.name}.${name} has a non-serializable attribute validator`,
          );
        }
        return {
          name,
          hasDefault: Object.prototype.hasOwnProperty.call(
            attribute,
            "default",
          ),
          ...(Object.prototype.hasOwnProperty.call(attribute, "default")
            ? { default: attribute.default }
            : {}),
          ...(typeof attribute.validate === "string"
            ? { validate: attribute.validate }
            : {}),
        };
      });
      return {
        name: type.name,
        attrs,
        ...Object.fromEntries(
          fields.flatMap((field) =>
            spec[field] === undefined ? [] : [[field, spec[field]]],
          ),
        ),
      };
    });
  }
  return {
    topNode: schema.spec.topNode ?? "doc",
    nodes: types(schema.nodes, NODE_FIELDS),
    marks: types(schema.marks, MARK_FIELDS),
  };
}

const ALL_NFM_NODE_KINDS_FIXTURE = [
  '# Heading {color="blue"}',
  'Paragraph with **bold**, *italic*, ~~strike~~, `code`, [link](https://example.com), $x^2$, a<br>break, and <span underline="true" color="red">styled text</span>.',
  "> Quote",
  "- bullet",
  "1. ordered",
  "- [x] task",
  "---",
  "```ts",
  "const answer = 42;",
  "```",
  "![Cover](https://example.com/cover.png)",
  '<video src="https://example.com/video.mp4" controls></video>',
  '<audio src="https://example.com/audio.mp3" controls></audio>',
  '<details summary="More">',
  "\tToggle body",
  "</details>",
  '<callout icon="💡">',
  "\tCallout body",
  "</callout>",
  "<columns>",
  "\t<column>",
  "\t\tColumn body",
  "\t</column>",
  "</columns>",
  '<synced_block url="https://example.com/block">',
  "\tSynced body",
  "</synced_block>",
  '<table header-row="true">',
  "\t<tr>",
  "\t\t<th>Header</th>",
  "\t</tr>",
  "\t<tr>",
  "\t\t<td>Cell</td>",
  "\t</tr>",
  "</table>",
  '<page url="https://example.com/page">Page</page>',
  '<Endpoint id="endpoint-1" method="GET" path="/api/items" />',
  '<ContentReference sourcePath="docs/example.md" title="Example" />',
  '<UnknownLocalComponent label="Preserved" />',
].join("\n");

describe("generated Content editor structural schema", () => {
  it("matches every structural field and ordered type in the live editor", async () => {
    const current = structuralSchemaSnapshot();
    await expect(`${JSON.stringify(current, null, 2)}\n`).toMatchFileSnapshot(
      "content-editor-structural-schema.generated.json",
    );
  });

  it("normalizes and converts every NFM node kind identically", () => {
    const json = nfmToDoc(ALL_NFM_NODE_KINDS_FIXTURE);
    const nodeTypes = new Set<string>();
    const markTypes = new Set<string>();
    const visit = (node: PMNode) => {
      nodeTypes.add(node.type);
      for (const mark of node.marks ?? []) markTypes.add(mark.type);
      for (const child of node.content ?? []) visit(child);
    };
    visit(json);
    expect([...nodeTypes].sort()).toEqual(
      Object.keys(getSchema(createVisualEditorExtensions()).nodes).sort(),
    );
    expect([...markTypes].sort()).toEqual([
      "bold",
      "code",
      "italic",
      "link",
      "notionSpan",
      "strike",
    ]);

    const live = getSchema(createVisualEditorExtensions());
    const structural = createContentEditorStructuralSchema();
    const liveJson = live.nodeFromJSON(json).toJSON();
    const structuralJson = structural.nodeFromJSON(json).toJSON();
    expect(structuralJson).toEqual(liveJson);

    const liveYdoc = new Y.Doc();
    const structuralYdoc = new Y.Doc();
    prosemirrorJSONToYXmlFragment(
      live,
      liveJson,
      liveYdoc.getXmlFragment("default"),
    );
    prosemirrorJSONToYXmlFragment(
      structural,
      structuralJson,
      structuralYdoc.getXmlFragment("default"),
    );
    expect(yDocToProsemirrorJSON(structuralYdoc, "default")).toEqual(
      yDocToProsemirrorJSON(liveYdoc, "default"),
    );
  });
});
