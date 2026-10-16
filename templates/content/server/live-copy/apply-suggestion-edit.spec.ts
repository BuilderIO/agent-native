import { prosemirrorJSONToYXmlFragment } from "@tiptap/y-tiptap";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { materializeLiveBody } from "../../shared/live-body.js";
import { nfmToDoc } from "../../shared/nfm.js";
import { suggestionEditorSchema } from "../../shared/suggestion-apply.js";
import { markdownSuggestionOperationsForFindReplace } from "../../shared/suggestion-diff.js";
import {
  applySuggestionEdit,
  type ApplySuggestionRefusal,
} from "./apply-suggestion-edit.js";

function seededDoc(markdown: string) {
  const doc = new Y.Doc();
  prosemirrorJSONToYXmlFragment(
    suggestionEditorSchema(),
    nfmToDoc(markdown),
    doc.getXmlFragment("default"),
  );
  return doc;
}

function copyOf(doc: Y.Doc) {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return copy;
}

function bodyOf(doc: Y.Doc) {
  const copy = copyOf(doc);
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
): void | ApplySuggestionRefusal {
  return applySuggestionEdit(doc, "default", {
    operation,
    acceptedSiblingRanges: [],
  });
}

/** Runs the edit on a worker's copy and returns the update it produced. */
function acceptElsewhere(doc: Y.Doc, operation: ReturnType<typeof suggestion>) {
  const worker = copyOf(doc);
  const base = Y.encodeStateVector(worker);
  const result = accept(worker, operation);
  if (result) throw new Error(`refused: ${JSON.stringify(result)}`);
  const update = Y.encodeStateAsUpdate(worker, base);
  worker.destroy();
  return update;
}

describe("applySuggestionEdit", () => {
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
    expect(
      accept(doc, suggestion(body, "sets the scene", "opens")),
    ).toBeUndefined();
    expect(bodyOf(doc)).toBe(body.replace("sets the scene", "opens"));
    const after = doc.getXmlFragment("default").toArray();
    expect(after).toHaveLength(before.length);
    // Every block keeps its element; the edited paragraph is changed in place.
    after.forEach((element, index) => expect(element).toBe(before[index]));
  });

  it("places the change on the live text, keeping edits the stored copy has not seen", () => {
    const doc = seededDoc(page);
    const operation = suggestion(bodyOf(doc), "sets the scene", "opens");
    // A tab types in another block after the suggestion was made.
    const peer = copyOf(doc);
    const closing = peer.getXmlFragment("default").get(3) as Y.XmlElement;
    (closing.get(0) as Y.XmlText).insert(0, "Unsaved typing. ");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(doc)));

    expect(accept(doc, operation)).toBeUndefined();
    const body = bodyOf(doc);
    expect(body).toContain("The first paragraph opens.");
    expect(body).toContain("Unsaved typing. A closing paragraph sits here.");
  });

  it("merges with a concurrent edit inside the same block", () => {
    const doc = seededDoc(page);
    const update = acceptElsewhere(doc, suggestion(bodyOf(doc), "$60", "$75"));
    const peer = copyOf(doc);
    const budget = peer.getXmlFragment("default").get(2) as Y.XmlElement;
    const text = budget.get(0) as Y.XmlText;
    text.insert(text.length, " Approved.");
    Y.applyUpdate(peer, update);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(doc)));
    expect(bodyOf(doc)).toBe(bodyOf(peer));
    expect(bodyOf(doc)).toContain("$75 for the team. Approved.");
  });

  it("adds a block between two others without touching them", () => {
    const doc = seededDoc(page);
    const body = bodyOf(doc);
    const before = doc.getXmlFragment("default").toArray();
    expect(
      accept(
        doc,
        suggestion(body, "The budget is", "A new paragraph.\nThe budget is"),
      ),
    ).toBeUndefined();
    expect(bodyOf(doc)).toBe(
      body.replace("The budget is", "A new paragraph.\nThe budget is"),
    );
    const after = doc.getXmlFragment("default").toArray();
    expect(after).toHaveLength(before.length + 1);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[after.length - 1]).toBe(before[before.length - 1]);
  });

  it("refuses to replace text a second time once the replaced text is gone", () => {
    const doc = seededDoc(page);
    const operation = suggestion(bodyOf(doc), "sets the scene", "opens");
    expect(accept(doc, operation)).toBeUndefined();
    const state = Y.encodeStateAsUpdate(doc);
    expect(accept(doc, operation)).toEqual({
      kind: "refused",
      reason: "suggestion_stale",
    });
    expect(Y.encodeStateAsUpdate(doc)).toEqual(state);
  });

  it("refuses a suggestion whose text is gone and leaves the page alone", () => {
    const doc = seededDoc(page);
    const operation = suggestion(bodyOf(doc), "sets the scene", "opens");
    const first = doc.getXmlFragment("default").get(1) as Y.XmlElement;
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
    const doc = seededDoc("Intro.\n\n| A | B |\n| --- | --- |\n| one | two |");
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
      applySuggestionEdit(doc, "other", {
        operation,
        acceptedSiblingRanges: [],
      }),
    ).toMatchObject({ kind: "refused", reason: "suggestion_unmappable" });
  });

  describe("on pages an agent wrote", () => {
    // Each page as an agent sends it, and a change to make in its live text.
    const fixtures: Array<{
      name: string;
      page: string;
      find: string;
      replace: string;
    }> = [
      {
        name: "an escaped underscore",
        page: "Run snake\\_case\\_name first.\n\nThen the rest.",
        find: "first",
        replace: "last",
      },
      {
        name: "underscore bold",
        page: "Keep __bold words__ here.\n\nThen the rest.",
        find: "here",
        replace: "there",
      },
      {
        name: "a dollar amount",
        page: "It costs $60 today.\n\nThen the rest.",
        find: "today",
        replace: "now",
      },
      {
        name: "table cells with edge spaces",
        page: "Intro.\n\n|  Name  | Cost |\n| --- | --- |\n|  Tea  | $60 |\n\nThen the rest.",
        find: "Intro",
        replace: "Opening",
      },
      {
        name: "blank lines",
        page: "First.\n\n\n\nSecond.\n\n\nThird.",
        find: "Second",
        replace: "Middle",
      },
    ];

    for (const fixture of fixtures) {
      it(`accepts on ${fixture.name} and leaves the other blocks alone`, () => {
        const doc = seededDoc(fixture.page);
        const body = bodyOf(doc);
        const before = doc.getXmlFragment("default").toArray();
        expect(
          accept(doc, suggestion(body, fixture.find, fixture.replace)),
        ).toBeUndefined();
        expect(bodyOf(doc)).toBe(body.replace(fixture.find, fixture.replace));
        const after = doc.getXmlFragment("default").toArray();
        expect(after).toHaveLength(before.length);
        after.forEach((element, index) => expect(element).toBe(before[index]));
      });
    }
  });
});
