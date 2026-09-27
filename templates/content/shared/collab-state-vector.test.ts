import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  compareCollabStateVectors,
  decideCollabBodySave,
  decodeCollabStateVector,
  encodeCollabStateVector,
} from "./collab-state-vector.js";

function type(doc: Y.Doc, text: string) {
  doc.getText("t").insert(doc.getText("t").length, text);
}

function sync(from: Y.Doc, to: Y.Doc) {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));
}

function vector(doc: Y.Doc) {
  return decodeCollabStateVector(encodeCollabStateVector(doc))!;
}

describe("collab state vectors", () => {
  it("round-trips and orders peers by what each has observed", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    type(a, "a1");
    sync(a, b);
    expect(compareCollabStateVectors(vector(a), vector(b))).toBe("equal");
    type(b, "b1");
    expect(compareCollabStateVectors(vector(b), vector(a))).toBe("ahead");
    expect(compareCollabStateVectors(vector(a), vector(b))).toBe("behind");
    type(a, "a2");
    expect(compareCollabStateVectors(vector(a), vector(b))).toBe("concurrent");
    sync(a, b);
    expect(compareCollabStateVectors(vector(b), vector(a))).toBe("ahead");
  });

  it("reports an unreadable vector instead of an empty one", () => {
    expect(decodeCollabStateVector("not base64!")).toBeNull();
  });
});

describe("collab body save decisions", () => {
  const a = new Y.Doc();
  const b = new Y.Doc();
  type(a, "a1");
  sync(a, b);
  type(b, "b1");
  const stored = encodeCollabStateVector(a);
  const current = {
    bodyRevision: 4,
    revisionToken: "body:4:x",
    stateVector: stored,
    stateVectorRevision: 4,
  };

  it("fast-forwards a tab that has observed the stored body", () => {
    expect(
      decideCollabBodySave({ incomingStateVector: vector(b), current }),
    ).toBe("write");
  });

  it("acknowledges a late save the stored body already contains", () => {
    const late = new Y.Doc();
    expect(
      decideCollabBodySave({ incomingStateVector: vector(late), current }),
    ).toBe("covered");
  });

  it("asks a tab missing a peer's edits to sync before writing", () => {
    type(a, "a2");
    const ahead = { ...current, stateVector: encodeCollabStateVector(a) };
    expect(
      decideCollabBodySave({ incomingStateVector: vector(b), current: ahead }),
    ).toBe("sync-required");
  });

  it("never orders against a vector recorded for an older body", () => {
    const external = { ...current, bodyRevision: 5, revisionToken: "body:5:y" };
    expect(
      decideCollabBodySave({
        incomingStateVector: vector(b),
        current: external,
      }),
    ).toBe("unproven");
    expect(
      decideCollabBodySave({
        incomingStateVector: vector(b),
        incomingIntegratedRevision: "body:5:y",
        current: external,
      }),
    ).toBe("write");
  });
});
