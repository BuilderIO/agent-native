import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { materializeLiveBody } from "./live-body.js";
import { nfmToDoc } from "./nfm.js";
import { suggestionEditorSchema } from "./suggestion-apply.js";
import { markdownSuggestionOperationsForFindReplace } from "./suggestion-diff.js";
import {
  acceptSuggestionOnLiveCopy,
  type AcceptSuggestionTaskOutput,
} from "./suggestion-live-copy-edit.js";

function seededDoc(markdown: string) {
  const doc = new Y.Doc();
  prosemirrorJSONToYXmlFragment(
    suggestionEditorSchema(),
    nfmToDoc(markdown),
    doc.getXmlFragment("default"),
  );
  return doc;
}

function bodyOf(doc: Y.Doc) {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  const live = materializeLiveBody(copy);
  copy.destroy();
  if (live.kind !== "body") throw new Error(`live copy is ${live.kind}`);
  return live.markdown;
}

function suggestion(before: string, find: string, replace: string) {
  const start = before.indexOf(find);
  if (start < 0) throw new Error(`"${find}" is not in the page`);
  const [operation] = markdownSuggestionOperationsForFindReplace({
    before,
    find,
    replace,
    start,
  });
  return operation!;
}

function accept(
  doc: Y.Doc,
  operation: ReturnType<typeof suggestion>,
): AcceptSuggestionTaskOutput {
  return acceptSuggestionOnLiveCopy({
    state: Y.encodeStateAsUpdate(doc),
    field: "default",
    input: { operation, acceptedSiblingRanges: [] },
  });
}

function applied(doc: Y.Doc, output: AcceptSuggestionTaskOutput) {
  if (output.kind !== "update")
    throw new Error(`expected an update, got ${JSON.stringify(output)}`);
  Y.applyUpdate(doc, output.update);
  return bodyOf(doc);
}

describe("acceptSuggestionOnLiveCopy", () => {
  const page = [
    "# Plan",
    "",
    "The first paragraph sets the scene.",
    "",
    "The budget is $60 for the team.",
    "",
    "A closing paragraph sits here.",
  ].join("\n");

  it("applies exactly the suggestion's change and keeps every other block's element", () => {
    const doc = seededDoc(page);
    const body = bodyOf(doc);
    const before = doc.getXmlFragment("default").toArray();
    const output = accept(doc, suggestion(body, "sets the scene", "opens"));
    expect(applied(doc, output)).toBe(body.replace("sets the scene", "opens"));
    const after = doc.getXmlFragment("default").toArray();
    expect(after).toHaveLength(before.length);
    // Every block keeps its element; the edited paragraph is changed in place.
    after.forEach((element, index) => expect(element).toBe(before[index]));
  });

  it("places the change on the live text, keeping edits the stored copy has not seen", () => {
    const doc = seededDoc(page);
    const stored = bodyOf(doc);
    const operation = suggestion(stored, "sets the scene", "opens");
    // A tab types in another block after the suggestion was made.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    const closing = peer.getXmlFragment("default").get(3) as Y.XmlElement;
    (closing.get(0) as Y.XmlText).insert(0, "Unsaved typing. ");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(doc)));

    const body = applied(doc, accept(doc, operation));
    expect(body).toContain("The first paragraph opens.");
    expect(body).toContain("Unsaved typing. A closing paragraph sits here.");
  });

  it("merges with a concurrent edit inside the same block", () => {
    const doc = seededDoc(page);
    const stored = bodyOf(doc);
    const output = accept(doc, suggestion(stored, "$60", "$75"));
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    const budget = peer.getXmlFragment("default").get(2) as Y.XmlElement;
    const text = budget.get(0) as Y.XmlText;
    text.insert(text.length, " Approved.");
    if (output.kind !== "update") throw new Error(output.kind);
    Y.applyUpdate(peer, output.update);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(doc)));
    expect(bodyOf(doc)).toBe(bodyOf(peer));
    expect(bodyOf(doc)).toContain("$75 for the team. Approved.");
  });

  it("adds a block between two others without touching them", () => {
    const doc = seededDoc(page);
    const body = bodyOf(doc);
    const before = doc.getXmlFragment("default").toArray();
    const output = accept(
      doc,
      suggestion(body, "The budget is", "A new paragraph.\nThe budget is"),
    );
    const next = applied(doc, output);
    expect(next).toBe(
      body.replace("The budget is", "A new paragraph.\nThe budget is"),
    );
    const after = doc.getXmlFragment("default").toArray();
    expect(after).toHaveLength(before.length + 1);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[after.length - 1]).toBe(before[before.length - 1]);
  });

  it("refuses a suggestion whose text is gone and leaves the page alone", () => {
    const doc = seededDoc(page);
    const stored = bodyOf(doc);
    const operation = suggestion(stored, "sets the scene", "opens");
    const fragment = doc.getXmlFragment("default");
    const first = fragment.get(1) as Y.XmlElement;
    const text = first.get(0) as Y.XmlText;
    text.delete(0, text.length);
    text.insert(0, "Rewritten entirely.");
    const state = Y.encodeStateAsUpdate(doc);
    expect(accept(doc, operation)).toEqual({
      kind: "refused",
      reason: "suggestion_stale",
    });
    expect(Y.encodeStateAsUpdate(doc)).toEqual(state);
  });

  it("refuses a change to a structure suggestions cannot review", () => {
    const table = "| A | B |\n| --- | --- |\n| one | two |";
    const doc = seededDoc(`Intro.\n\n${table}`);
    const body = bodyOf(doc);
    const row = "<tr>\n<td>one</td>\n<td>two</td>\n</tr>";
    expect(body).toContain(row);
    const state = Y.encodeStateAsUpdate(doc);
    const addedRow = row.replace("one", "three").replace("two", "four");
    expect(
      accept(doc, suggestion(body, row, `${row}\n${addedRow}`)),
    ).toMatchObject({
      kind: "refused",
      reason: "suggestion_structure_unsupported",
    });
    expect(Y.encodeStateAsUpdate(doc)).toEqual(state);
  });

  it("refuses a page with an inline database", () => {
    const doc = seededDoc(
      'Intro.\n\n<InlineDatabase databaseId="db-1" databaseDocumentId="doc-db-1" ownerBlockId="block-1" />',
    );
    const body = bodyOf(doc);
    expect(body).toContain("<InlineDatabase");
    expect(accept(doc, suggestion(body, "Intro", "Opening"))).toMatchObject({
      kind: "refused",
      reason: "suggestion_body_unavailable",
    });
  });

  it("refuses a field other than the page body", () => {
    const doc = seededDoc("Intro.");
    const operation = suggestion(bodyOf(doc), "Intro", "Opening");
    expect(
      acceptSuggestionOnLiveCopy({
        state: Y.encodeStateAsUpdate(doc),
        field: "other",
        input: { operation, acceptedSiblingRanges: [] },
      }),
    ).toMatchObject({ kind: "refused", reason: "suggestion_unmappable" });
  });
});
