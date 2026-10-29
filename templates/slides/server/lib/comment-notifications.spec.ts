import { describe, expect, it } from "vitest";

import { renderDeckCommentEmail } from "./comment-notifications.js";

// oracle-change: recipients and delivery moved to core notifyReviewComment; Slides only renders the email.
describe("deck comment emails", () => {
  it("gives a mention, a reply and a comment their own subject and heading", () => {
    const render = (kind: "mention" | "reply" | "comment") =>
      renderDeckCommentEmail({
        actor: "Sam",
        title: "Q3 review",
        url: "https://slides.test/deck/deck_1?comment=thread_9",
        content: "Needs   the\nnew chart",
        kind,
      });

    const mention = render("mention");
    const reply = render("reply");
    const comment = render("comment");

    expect(mention.subject).toBe('Sam mentioned you on "Q3 review"');
    expect(reply.subject).toBe('Sam replied to a comment on "Q3 review"');
    expect(comment.subject).toBe('Sam commented on "Q3 review"');
    expect(mention.text).toContain("You were mentioned");
    expect(reply.text).toContain("New reply on your deck");
    expect(comment.text).toContain("New comment");
    for (const email of [mention, reply, comment]) {
      expect(email.text).toContain('"Needs the new chart"');
      expect(email.html).toContain(
        "https://slides.test/deck/deck_1?comment=thread_9",
      );
    }
  });
});
