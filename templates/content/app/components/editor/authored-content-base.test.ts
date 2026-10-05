import { describe, expect, it } from "vitest";

import { createAuthoredContentBase } from "./authored-content-base";

const authoredOn = { revision: "r1", content: "Alpha.\nBravo." };
const merged = { revision: "r2", content: "Alpha. peer\nBravo. mine" };

function afterMergedSave() {
  const tracker = createAuthoredContentBase();
  tracker.saved({
    saved: merged,
    editorContent: "Alpha.\nBravo. mine",
    authoredOn,
  });
  return tracker;
}

describe("authored content base", () => {
  it("authors on the saved body when the editor already holds it", () => {
    const tracker = createAuthoredContentBase();
    tracker.saved({ saved: merged, editorContent: merged.content, authoredOn });
    expect(tracker.base(merged)).toEqual(merged);
  });

  it("keeps the merged save's own base while the editor lacks the peer's text", () => {
    const tracker = afterMergedSave();
    expect(tracker.base(merged)).toEqual(authoredOn);
    tracker.observed("Alpha.\nBravo. mine more", merged);
    expect(tracker.base(merged)).toEqual(authoredOn);
  });

  it("authors a later deletion of the peer's text on the body that held it", () => {
    const tracker = afterMergedSave();
    // The peer's text arrives through collaboration, so no reconcile runs.
    tracker.observed(merged.content, merged);
    // Removing " peer" now reads as a deletion against the saved body, not as
    // an edit that never touched the paragraph the peer changed.
    expect(tracker.base(merged)).toEqual(merged);
  });

  it("releases the held base once the reconcile merges that revision", () => {
    const tracker = afterMergedSave();
    tracker.merged("r9");
    expect(tracker.base(merged)).toEqual(authoredOn);
    tracker.merged("r2");
    expect(tracker.base(merged)).toEqual(merged);
  });

  it("follows the saved body once a later save moves past the held one", () => {
    const tracker = afterMergedSave();
    const later = { revision: "r3", content: "Alpha. peer\nBravo. mine!" };
    expect(tracker.base(later)).toEqual(later);
    tracker.reset();
    expect(tracker.base(merged)).toEqual(merged);
  });
});
