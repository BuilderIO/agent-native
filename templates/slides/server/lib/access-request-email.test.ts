import { describe, expect, it } from "vitest";

import {
  renderDeckAccessGrantedEmail,
  renderDeckAccessRequestEmail,
} from "./access-request-email";

const baseInput = {
  requesterName: "Requester",
  requesterEmail: "requester@example.com",
  deckTitle: "Quarterly Review",
  url: "https://slides.example/deck/deck-1",
  allowAccessUrl: "https://slides.example/access-request/approve",
};

describe("renderDeckAccessRequestEmail", () => {
  it("quotes the requester's note escaped", () => {
    const email = renderDeckAccessRequestEmail({
      ...baseInput,
      note: "Reviewing <b>launch</b> deck",
    });

    expect(email.html).toContain("Reviewing &lt;b&gt;launch&lt;/b&gt; deck");
    expect(email.text).toContain("Reviewing <b>launch</b> deck");
  });

  it("omits the quote when there is no note", () => {
    const withNote = renderDeckAccessRequestEmail({ ...baseInput, note: "x" });
    const withoutNote = renderDeckAccessRequestEmail(baseInput);

    expect(withoutNote.html.length).toBeLessThan(withNote.html.length);
    expect(withoutNote.text).not.toContain("\nx\n");
  });
});

describe("renderDeckAccessGrantedEmail", () => {
  it("tells the requester who approved and links to the deck", () => {
    const email = renderDeckAccessGrantedEmail({
      approverName: "Alex <Kim>",
      deckTitle: "Quarterly Review",
      url: "https://slides.example/deck/deck-1",
    });

    expect(email.subject).toBe('You now have access to "Quarterly Review"');
    expect(email.html).toContain("Alex &lt;Kim&gt;");
    expect(email.html).toContain("https://slides.example/deck/deck-1");
  });
});
