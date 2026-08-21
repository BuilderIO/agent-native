import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { diffTextSplice, writeCollabText } from "./collab-sync";

const applyBoth = (previous: string, next: string) => {
  const { index, removeLength, insert } = diffTextSplice(previous, next);
  return (
    previous.slice(0, index) + insert + previous.slice(index + removeLength)
  );
};

describe("diffTextSplice", () => {
  it("reduces a mid-document deletion to the removed range", () => {
    const previous = "<a></a><b>gone</b><c></c>";
    const next = "<a></a><c></c>";
    expect(diffTextSplice(previous, next)).toEqual({
      index: 8,
      removeLength: 11,
      insert: "",
    });
    expect(applyBoth(previous, next)).toBe(next);
  });

  it("reduces an attribute edit to the changed characters", () => {
    const previous = '<div class="p-4 text-sm">x</div>';
    const next = '<div class="p-8 text-sm">x</div>';
    const splice = diffTextSplice(previous, next);
    expect(splice.removeLength).toBe(1);
    expect(splice.insert).toBe("8");
    expect(applyBoth(previous, next)).toBe(next);
  });

  it("never splits a surrogate pair", () => {
    const previous = "<p>🎨🎯</p>";
    const next = "<p>🎨</p>";
    const splice = diffTextSplice(previous, next);
    expect(splice.index % 1).toBe(0);
    expect(applyBoth(previous, next)).toBe(next);
    expect(Array.from(applyBoth(previous, next))).not.toContain("\ud83c");
  });

  it("round-trips arbitrary edits", () => {
    const base = "0123456789abcdefghij";
    for (let start = 0; start < base.length; start += 1) {
      for (let length = 0; length <= base.length - start; length += 1) {
        const next = `${base.slice(0, start)}ZZ${base.slice(start + length)}`;
        expect(applyBoth(base, next)).toBe(next);
      }
    }
  });
});

describe("writeCollabText", () => {
  const html = `<main>${Array.from({ length: 200 }, (_, i) => `<div id="n${i}">row ${i}</div>`).join("")}</main>`;

  it("ships only the changed range instead of the whole document", () => {
    const doc = new Y.Doc();
    const ytext = doc.getText("content");
    ytext.insert(0, html);
    new Y.UndoManager(ytext, { trackedOrigins: new Set(["local"]) });

    let wireBytes = 0;
    doc.on("update", (update: Uint8Array) => {
      wireBytes += update.byteLength;
    });
    expect(
      writeCollabText(
        doc,
        ytext,
        html.replace('<div id="n5">row 5</div>', ""),
        "local",
      ),
    ).toBe(true);

    expect(ytext.toString()).not.toContain('id="n5"');
    expect(ytext.toString()).toContain('id="n6"');
    expect(wireBytes).toBeLessThan(200);
  });

  it("reports no write when the document already holds the content", () => {
    const doc = new Y.Doc();
    const ytext = doc.getText("content");
    ytext.insert(0, html);
    expect(writeCollabText(doc, ytext, html, "local")).toBe(false);
  });

  it("merges concurrent deletions instead of duplicating the document", () => {
    const seed = new Y.Doc();
    seed.getText("content").insert(0, "<a>1</a><b>2</b><c>3</c>");
    const state = Y.encodeStateAsUpdate(seed);

    const left = new Y.Doc();
    Y.applyUpdate(left, state);
    const right = new Y.Doc();
    Y.applyUpdate(right, state);

    writeCollabText(left, left.getText("content"), "<b>2</b><c>3</c>", "local");
    writeCollabText(
      right,
      right.getText("content"),
      "<a>1</a><b>2</b>",
      "local",
    );

    Y.applyUpdate(left, Y.encodeStateAsUpdate(right));
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));

    expect(left.getText("content").toString()).toBe("<b>2</b>");
    expect(right.getText("content").toString()).toBe("<b>2</b>");
  });

  it("keeps undo working on the spliced range", () => {
    const doc = new Y.Doc();
    const ytext = doc.getText("content");
    ytext.insert(0, html);
    const undo = new Y.UndoManager(ytext, {
      trackedOrigins: new Set(["local"]),
    });

    writeCollabText(
      doc,
      ytext,
      html.replace('<div id="n5">row 5</div>', ""),
      "local",
    );
    expect(ytext.toString()).not.toContain('id="n5"');
    undo.undo();
    expect(ytext.toString()).toBe(html);
  });
});
