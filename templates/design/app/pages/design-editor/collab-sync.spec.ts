import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { writeCollabText } from "./collab-sync";

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

describe("writeCollabText multi-region diffs", () => {
  it("leaves the untouched middle alone when both ends change", () => {
    const doc = new Y.Doc();
    const ytext = doc.getText("content");
    ytext.insert(0, "abcdef");

    const seen: Array<[number, string]> = [];
    ytext.observe((event) => {
      let at = 0;
      for (const change of event.changes.delta) {
        if (change.retain) at += change.retain;
        else if (change.insert) seen.push([at, String(change.insert)]);
        else if (change.delete) seen.push([at, `-${change.delete}`]);
      }
    });

    writeCollabText(doc, ytext, "XbcdeY", "local");

    expect(ytext.toString()).toBe("XbcdeY");
    // One splice would have spanned all six characters and taken "bcde" with it.
    expect(seen.every(([, text]) => text.length <= 2)).toBe(true);
  });

  it("keeps a peer's edit inside the untouched gap", () => {
    const seed = new Y.Doc();
    seed.getText("content").insert(0, "<a>one</a><b>two</b><c>three</c>");
    const state = Y.encodeStateAsUpdate(seed);
    const left = new Y.Doc();
    Y.applyUpdate(left, state);
    const right = new Y.Doc();
    Y.applyUpdate(right, state);

    // Left rewrites both ends; right edits the middle nobody touched.
    writeCollabText(
      left,
      left.getText("content"),
      "<a>ONE</a><b>two</b><c>THREE</c>",
      "local",
    );
    const middle = right.getText("content").toString().indexOf("two");
    right.getText("content").insert(middle + 3, "!");

    Y.applyUpdate(left, Y.encodeStateAsUpdate(right));
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));

    expect(left.getText("content").toString()).toBe(
      "<a>ONE</a><b>two!</b><c>THREE</c>",
    );
    expect(left.getText("content").toString()).toBe(
      right.getText("content").toString(),
    );
  });

  it("still ships only the changed range for a single edit", () => {
    const html = `<main>${Array.from({ length: 300 }, (_, i) => `<div data-agent-native-node-id="n${i}" class="p-4">row ${i}</div>`).join("")}</main>`;
    const doc = new Y.Doc();
    const ytext = doc.getText("content");
    ytext.insert(0, html);
    new Y.UndoManager(ytext, { trackedOrigins: new Set(["local"]) });

    let wireBytes = 0;
    doc.on("update", (update: Uint8Array) => {
      wireBytes += update.byteLength;
    });
    writeCollabText(
      doc,
      ytext,
      html.replace('n150" class="p-4"', 'n150" class="p-8"'),
      "local",
    );

    expect(ytext.toString()).toContain('n150" class="p-8"');
    expect(wireBytes).toBeLessThan(200);
  });
});
