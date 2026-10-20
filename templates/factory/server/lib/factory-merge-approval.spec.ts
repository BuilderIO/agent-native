import { describe, expect, it } from "vitest";

import {
  approvalRequiredMessage,
  countApprovals,
  type ApprovalCounts,
} from "./factory-merge-approval.js";

const HEAD = "head-new";
const AUTHOR = "builder-io-integration[bot]";

let clock = 0;
/** A review submitted one minute after the one before it, unless a time is given. */
function review(
  author: string,
  state: string,
  extra: Record<string, unknown> = {},
) {
  clock += 1;
  return {
    author,
    state,
    commitSha: HEAD,
    authorAssociation: "MEMBER",
    observedAt: new Date(Date.UTC(2026, 9, 19, 12, clock)).toISOString(),
    ...extra,
  } as Parameters<typeof countApprovals>[0][number];
}

const count = (
  reviews: Parameters<typeof countApprovals>[0],
  authorLogin = AUTHOR,
) => countApprovals(reviews, { headSha: HEAD, authorLogin });

const none: ApprovalCounts = {
  seen: 0,
  qualifying: 0,
  byAuthor: 0,
  fromBots: 0,
  fromNonCollaborators: 0,
  stale: 0,
};

describe("countApprovals", () => {
  it("counts no approval when nobody has reviewed", () => {
    expect(count([])).toEqual(none);
  });

  it.each(["OWNER", "MEMBER", "COLLABORATOR", "member"])(
    "counts an approval of the head commit from a reviewer GitHub lists as %s",
    (authorAssociation) => {
      expect(
        count([review("maintainer", "approved", { authorAssociation })]),
      ).toEqual({
        ...none,
        seen: 1,
        qualifying: 1,
      });
    },
  );

  it.each([
    "CONTRIBUTOR",
    "FIRST_TIME_CONTRIBUTOR",
    "NONE",
    "MANNEQUIN",
    undefined,
  ])(
    "does not count an approval from a reviewer GitHub lists as %s",
    (authorAssociation) => {
      expect(
        count([review("stranger", "approved", { authorAssociation })]),
      ).toEqual({
        ...none,
        seen: 1,
        fromNonCollaborators: 1,
      });
    },
  );

  it.each(["dependabot[bot]", "Some-App[BOT]"])(
    "does not count %s's approval even though GitHub lists it as a member",
    (login) => {
      expect(
        count([review(login, "approved", { authorAssociation: "MEMBER" })]),
      ).toEqual({ ...none, seen: 1, fromBots: 1 });
    },
  );

  it("does not count an approval from a user GitHub types as a Bot, whatever its login", () => {
    expect(
      count([
        review("review-helper", "approved", {
          authorAssociation: "OWNER",
          authorType: "Bot",
        }),
      ]),
    ).toEqual({ ...none, seen: 1, fromBots: 1 });
  });

  it("does not count one Builder account approving another's pull request", () => {
    // `builder-io-integration[bot]` is a bot by its login; `builderio-bot` is a machine user with no `[bot]` and a member's association.
    expect(
      count(
        [
          review("builder-io-integration[bot]", "approved", {
            authorAssociation: "MEMBER",
          }),
        ],
        "builderio-bot",
      ),
    ).toEqual({ ...none, seen: 1, fromBots: 1 });
    expect(
      count([
        review("BuilderIO-Bot", "approved", {
          authorAssociation: "MEMBER",
          authorType: "User",
        }),
      ]),
    ).toEqual({ ...none, seen: 1, fromBots: 1 });
  });

  it("still counts a human collaborator, a user GitHub types as User", () => {
    expect(
      count([
        review("maintainer", "approved", {
          authorAssociation: "COLLABORATOR",
          authorType: "User",
        }),
      ]),
    ).toEqual({ ...none, seen: 1, qualifying: 1 });
  });

  it("does not count a bot with no collaborator standing either, and counts it once, as a bot", () => {
    expect(
      count([
        review("github-actions[bot]", "approved", {
          authorAssociation: "CONTRIBUTOR",
        }),
      ]),
    ).toEqual({ ...none, seen: 1, fromBots: 1 });
  });

  it("does not count the author approving their own pull request, whatever their association or the case of their login", () => {
    expect(
      count([
        review("Builder-IO-Integration[bot]", "approved", {
          authorAssociation: "OWNER",
        }),
      ]),
    ).toEqual({ ...none, seen: 1, byAuthor: 1 });
  });

  it("does not count an approval given on an earlier commit, nor one with no commit at all", () => {
    expect(
      count([
        review("maintainer", "approved", { commitSha: "head-old" }),
        review("second", "approved", { commitSha: undefined }),
      ]),
    ).toEqual({ ...none, seen: 2, stale: 2 });
  });

  it("needs a new approval after a push: the old one goes stale and the fresh one counts", () => {
    const before = [
      review("maintainer", "approved", { commitSha: "head-old" }),
    ];
    expect(count(before)).toEqual({ ...none, seen: 1, stale: 1 });

    expect(
      count([...before, review("maintainer", "approved", { commitSha: HEAD })]),
    ).toEqual({ ...none, seen: 1, qualifying: 1 });
  });

  it("lets a later request for changes or a dismissal cancel the same reviewer's approval", () => {
    expect(
      count([review("a", "approved"), review("a", "changes_requested")]),
    ).toEqual(none);
    expect(count([review("a", "approved"), review("a", "dismissed")])).toEqual(
      none,
    );
    expect(
      count([
        review("a", "approved"),
        review("a", "changes_requested"),
        review("a", "approved"),
      ]),
    ).toEqual({ ...none, seen: 1, qualifying: 1 });
  });

  it("keeps an approval through a later comment or an unsubmitted draft review", () => {
    expect(
      count([
        review("a", "approved"),
        review("a", "commented"),
        review("a", "pending"),
      ]),
    ).toEqual({ ...none, seen: 1, qualifying: 1 });
  });

  it("counts each reviewer once, by their latest standing review, in any case of their login", () => {
    expect(
      count([
        review("Maintainer", "approved"),
        review("maintainer", "approved"),
        review("other", "changes_requested"),
      ]),
    ).toEqual({ ...none, seen: 1, qualifying: 1 });
  });

  it("with one reviewer approving and another requesting changes, the approval still counts (the blocking review is the gate's other rule)", () => {
    expect(
      count([review("a", "approved"), review("b", "changes_requested")]),
    ).toEqual({ ...none, seen: 1, qualifying: 1 });
  });

  it("orders reviews by when they were submitted, and by position when the times tie", () => {
    const earlier = review("a", "approved");
    const later = review("a", "changes_requested");
    expect(count([later, earlier])).toEqual(none);

    const tied = { observedAt: "2026-10-19T12:00:00.000Z" };
    expect(
      count([
        review("a", "approved", tied),
        review("a", "changes_requested", tied),
      ]),
    ).toEqual(none);
    expect(
      count([
        review("a", "changes_requested", tied),
        review("a", "approved", tied),
      ]),
    ).toEqual({ ...none, seen: 1, qualifying: 1 });
  });

  it("puts every approval in exactly one bucket, so the buckets add up to what was seen", () => {
    const counts = count([
      review("good", "approved"),
      review(AUTHOR, "approved", { authorAssociation: "NONE", commitSha: "x" }),
      review("stranger", "approved", {
        authorAssociation: "NONE",
        commitSha: "x",
      }),
      review("app[bot]", "approved", { commitSha: "x" }),
      review("old", "approved", { commitSha: "head-old" }),
    ]);
    expect(counts).toEqual({
      seen: 5,
      qualifying: 1,
      byAuthor: 1,
      fromBots: 1,
      fromNonCollaborators: 1,
      stale: 1,
    });
    expect(
      counts.qualifying +
        counts.byAuthor +
        counts.fromBots +
        counts.fromNonCollaborators +
        counts.stale,
    ).toBe(counts.seen);
  });
});

describe("approvalRequiredMessage", () => {
  it("names the bucket each approval that does not count fell into, and says nothing of buckets that are empty", () => {
    expect(approvalRequiredMessage(none)).toBe(
      "No owner, member or collaborator other than the author has approved the current head commit.",
    );
    const message = approvalRequiredMessage({
      seen: 5,
      qualifying: 0,
      byAuthor: 1,
      fromBots: 1,
      fromNonCollaborators: 2,
      stale: 1,
    });
    expect(message).toContain("1 approval on an earlier commit");
    expect(message).toContain("1 approval from a bot or Builder account");
    expect(message).toContain(
      "2 approvals from someone who is not an owner, member or collaborator",
    );
    expect(message).toContain("1 approval from the pull request's own author");
  });
});
