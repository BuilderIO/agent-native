import { describe, expect, it } from "vitest";

import { createAuthoredContentBase } from "./authored-content-base";

const authoredOn = { revision: "r1", content: "Alpha.\nBravo." };
const merged = { revision: "r2", content: "Alpha. peer\nBravo. mine" };

function afterMergedSave() {
  const tracker = createAuthoredContentBase();
  tracker.edited("Alpha.\nBravo. mine");
  tracker.saved({
    saved: merged,
    sentContent: "Alpha.\nBravo. mine",
    authoredOn,
  });
  return tracker;
}

describe("authored content base", () => {
  it("authors on the saved body when the editor already holds it", () => {
    const tracker = createAuthoredContentBase();
    tracker.observed(merged.content, authoredOn);
    // An earlier answer starts a new save; the editor still holds the text.
    tracker.saved({
      saved: authoredOn,
      sentContent: authoredOn.content,
      authoredOn,
    });
    tracker.saved({
      saved: merged,
      sentContent: "Alpha.\nBravo. mine",
      authoredOn,
    });
    expect(tracker.base(merged)).toEqual(merged);
  });

  it("authors on the saved body when the peer's text and more typing arrived before the answer", () => {
    const tracker = createAuthoredContentBase();
    tracker.observed("Alpha. peer\nBravo. mine", authoredOn);
    tracker.edited("Alpha. peer\nBravo. mine and more");
    tracker.saved({
      saved: merged,
      sentContent: "Alpha.\nBravo. mine",
      authoredOn,
    });
    expect(tracker.base(merged)).toEqual(merged);
  });

  it("authors on the saved body when the peer's text arrived and was deleted before the answer", () => {
    const tracker = createAuthoredContentBase();
    tracker.observed("Alpha. peer\nBravo. mine", authoredOn);
    tracker.edited("Alpha.\nBravo. mine");
    tracker.saved({
      saved: merged,
      sentContent: "Alpha.\nBravo. mine",
      authoredOn,
    });
    expect(tracker.base(merged)).toEqual(merged);
  });

  it("keeps what the editor showed for a save queued behind an earlier one", () => {
    const tracker = createAuthoredContentBase();
    tracker.edited("Alpha.\nBravo. mine");
    // The first save is out; more typing queues a second one behind it.
    tracker.edited("Alpha.\nBravo. mine more");
    tracker.observed("Alpha. peer\nBravo. mine more", authoredOn);
    tracker.edited("Alpha.\nBravo. mine more");
    const first = { revision: "r2", content: "Alpha.\nBravo. mine" };
    tracker.saved({ saved: first, sentContent: first.content, authoredOn });
    const second = { revision: "r3", content: "Alpha. peer\nBravo. mine more" };
    tracker.saved({
      saved: second,
      sentContent: "Alpha.\nBravo. mine more",
      authoredOn,
    });
    // The peer's text was shown and deleted here, so the deletion sticks.
    expect(tracker.base(second)).toEqual(second);
  });

  it("authors on the winner a displaced save adopted", () => {
    const tracker = createAuthoredContentBase();
    const winner = { revision: "r2", content: "Alpha. peer\nBravo." };
    tracker.observed(winner.content, authoredOn);
    tracker.saved({
      saved: winner,
      sentContent: "Alpha.\nBravo. mine",
      authoredOn,
    });
    expect(tracker.base(winner)).toEqual(winner);
  });

  it("keeps the merged save's own base while the editor lacks the peer's text", () => {
    const tracker = afterMergedSave();
    expect(tracker.base(merged)).toEqual(authoredOn);
    tracker.observed("Alpha.\nBravo. mine more", merged);
    expect(tracker.base(merged)).toEqual(authoredOn);
  });

  it("keeps the merged save's own base when the editor reports its unchanged text again", () => {
    const tracker = afterMergedSave();
    // The page's local copy took the saved body with the answer, so the page
    // saves this report as an edit. Authored on the saved body, that edit
    // deletes the peer's text.
    tracker.edited("Alpha.\nBravo. mine");
    expect(tracker.base(merged)).toEqual(authoredOn);
  });

  it("releases the held base when the peer's text arrives alongside typing here", () => {
    const tracker = afterMergedSave();
    tracker.observed("Alpha. peer\nBravo. mine more", merged);
    expect(tracker.base(merged)).toEqual(merged);
  });

  it("releases the held base on a page an agent stored as blank-line Markdown", () => {
    const tracker = createAuthoredContentBase();
    const agentBody = { revision: "r1", content: "Alpha.\n\nBravo." };
    tracker.edited("Alpha.\nBravo. mine");
    tracker.saved({
      saved: merged,
      sentContent: "Alpha.\nBravo. mine",
      authoredOn: agentBody,
    });
    expect(tracker.base(merged)).toEqual(agentBody);
    tracker.observed("Alpha. peer\nBravo. mine more", merged);
    expect(tracker.base(merged)).toEqual(merged);
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

  it("forgets the editor's text with the page it belonged to", () => {
    const tracker = createAuthoredContentBase();
    tracker.observed(merged.content, authoredOn);
    tracker.reset();
    tracker.saved({
      saved: merged,
      sentContent: "Alpha.\nBravo. mine",
      authoredOn,
    });
    expect(tracker.base(merged)).toEqual(authoredOn);
  });
});
