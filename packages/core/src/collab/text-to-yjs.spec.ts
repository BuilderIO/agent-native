import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { applyTextToYDoc, initYDocWithText } from "./text-to-yjs.js";

describe("applyTextToYDoc", () => {
  it("inserts text into an empty field", () => {
    const doc = new Y.Doc();
    const update = applyTextToYDoc(doc, "content", "hello world");
    expect(update.length).toBeGreaterThan(0);
    expect(doc.getText("content").toString()).toBe("hello world");
  });

  it("returns an empty update and makes no change when text is identical", () => {
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "unchanged");
    const update = applyTextToYDoc(doc, "content", "unchanged");
    expect(update.length).toBe(0);
    expect(doc.getText("content").toString()).toBe("unchanged");
  });

  it("applies a minimal middle edit preserving the surrounding text", () => {
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "the quick brown fox");
    applyTextToYDoc(doc, "content", "the quick red fox");
    expect(doc.getText("content").toString()).toBe("the quick red fox");
  });

  it("handles a pure deletion to empty", () => {
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "delete me");
    applyTextToYDoc(doc, "content", "");
    expect(doc.getText("content").toString()).toBe("");
  });

  it("performs a minimal delete that keeps the unchanged tail intact", () => {
    const doc = new Y.Doc();
    const ytext = doc.getText("content");
    ytext.insert(0, "PREFIX-KEEP THIS TAIL");

    const tailIndex = "PREFIX-".length;
    const relPos = Y.createRelativePositionFromTypeIndex(ytext, tailIndex);

    applyTextToYDoc(doc, "content", "KEEP THIS TAIL");

    const resolved = Y.createAbsolutePositionFromRelativePosition(relPos, doc);
    expect(doc.getText("content").toString()).toBe("KEEP THIS TAIL");
    expect(resolved?.index).toBe(0);
  });

  it("tags the produced transaction with the supplied origin", () => {
    const doc = new Y.Doc();
    let seenOrigin: unknown = "unset";
    doc.on("afterTransaction", (txn) => {
      seenOrigin = txn.origin;
    });
    applyTextToYDoc(doc, "content", "x", "agent");
    expect(seenOrigin).toBe("agent");
  });

  it("update replays into another doc reproducing the same text", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const update = applyTextToYDoc(a, "content", "sync me");
    Y.applyUpdate(b, update);
    expect(b.getText("content").toString()).toBe("sync me");
  });
});

describe("initYDocWithText", () => {
  it("seeds a doc and returns a replayable state", () => {
    const { doc, state } = initYDocWithText("content", "seed text");
    expect(doc.getText("content").toString()).toBe("seed text");

    const replay = new Y.Doc();
    Y.applyUpdate(replay, state);
    expect(replay.getText("content").toString()).toBe("seed text");
  });

  it("produces a non-empty state for empty seed text (structural metadata only)", () => {
    const { doc, state } = initYDocWithText("content", "");
    expect(doc.getText("content").toString()).toBe("");
    expect(state).toBeInstanceOf(Uint8Array);
  });
});
