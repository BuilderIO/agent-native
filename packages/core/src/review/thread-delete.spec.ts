import { describe, expect, it } from "vitest";

import { canDeleteReviewThread } from "./thread-delete.js";

const base = {
  isEditor: false,
  actorEmail: "alice@example.com",
  rootAuthorEmail: "alice@example.com",
  replyAuthorEmails: [] as string[],
};

describe("canDeleteReviewThread", () => {
  it("lets an editor delete any thread, whoever wrote it", () => {
    expect(
      canDeleteReviewThread({
        isEditor: true,
        actorEmail: "ed@example.com",
        rootAuthorEmail: "alice@example.com",
        replyAuthorEmails: ["bob@example.com", null],
      }),
    ).toBe(true);
  });

  it("lets a commenter delete their own thread with no replies", () => {
    expect(canDeleteReviewThread(base)).toBe(true);
  });

  it("lets a commenter delete their own thread when every reply is theirs", () => {
    expect(
      canDeleteReviewThread({
        ...base,
        replyAuthorEmails: ["alice@example.com", " Alice@Example.com "],
      }),
    ).toBe(true);
  });

  it("refuses a commenter a thread that holds someone else's reply", () => {
    expect(
      canDeleteReviewThread({
        ...base,
        replyAuthorEmails: ["alice@example.com", "bob@example.com"],
      }),
    ).toBe(false);
  });

  it("refuses a reply with no author address, which is not the actor's", () => {
    expect(canDeleteReviewThread({ ...base, replyAuthorEmails: [null] })).toBe(
      false,
    );
  });

  it("refuses a commenter a thread someone else started", () => {
    expect(
      canDeleteReviewThread({ ...base, rootAuthorEmail: "bob@example.com" }),
    ).toBe(false);
  });

  it("refuses an actor with no address", () => {
    expect(
      canDeleteReviewThread({
        ...base,
        actorEmail: null,
        rootAuthorEmail: null,
      }),
    ).toBe(false);
  });
});
