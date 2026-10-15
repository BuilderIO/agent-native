import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  type Activity,
  addBusinessDays,
  auditFlags,
  businessDaysBetween,
  classifyClock,
  coAuthorTrailer,
  describeClock,
  greetingName,
  overlapsFor,
  parseOwnerMap,
  runCommunityPrsCli,
  standingReviews,
  suggestOwner,
} from "./community-prs.ts";

const DAY = 24 * 60 * 60 * 1000;

function at(iso: string, days = 0): string {
  return new Date(Date.parse(iso) + days * DAY).toISOString();
}

function act(
  actor: Activity["actor"],
  when: string,
  overrides: Partial<Activity> = {},
): Activity {
  return {
    at: when,
    actor,
    login: actor === "author" ? "contrib" : "dev",
    kind: actor === "author" ? "commit" : "comment",
    ...overrides,
  };
}

describe("business days", () => {
  it("skips weekends", () => {
    // 2026-10-09 is a Friday.
    assert.equal(
      businessDaysBetween(
        new Date("2026-10-09T12:00:00Z"),
        new Date("2026-10-12T12:00:00Z"),
      ),
      1,
    );
    assert.equal(
      addBusinessDays(new Date("2026-10-09T10:00:00Z"), 2).toISOString(),
      "2026-10-13T10:00:00.000Z",
    );
    assert.equal(
      addBusinessDays(new Date("2026-10-10T10:00:00Z"), 2).toISOString(),
      "2026-10-14T00:00:00.000Z",
    );
  });
});

describe("classifyClock", () => {
  const createdAt = "2026-09-01T09:00:00.000Z";

  it("starts no clock on drafts", () => {
    assert.deepEqual(
      classifyClock({
        createdAt,
        isDraft: true,
        activity: [],
        now: new Date(at(createdAt, 40)),
      }),
      { kind: "draft" },
    );
  });

  it("counts the first reply from ready-for-review", () => {
    const readyAt = "2026-09-14T09:00:00.000Z";
    const clock = classifyClock({
      createdAt,
      readyAt,
      isDraft: false,
      activity: [act("author", createdAt)],
      now: new Date("2026-09-17T09:00:00.000Z"),
    });
    assert.equal(clock.kind, "first-reply");
    assert.equal(clock.kind === "first-reply" && clock.waitingBusinessDays, 3);
    assert.equal(
      clock.kind === "first-reply" && clock.dueAt,
      "2026-09-16T09:00:00.000Z",
    );
  });

  it("doesn't count a reply left while it was a draft", () => {
    const readyAt = "2026-09-14T09:00:00.000Z";
    const clock = classifyClock({
      createdAt,
      readyAt,
      isDraft: false,
      activity: [
        act("author", createdAt),
        act("builder", at(createdAt, 2), { body: "ping us when it's ready" }),
      ],
      now: new Date("2026-09-15T09:00:00.000Z"),
    });
    assert.equal(clock.kind, "first-reply");
    assert.equal(clock.kind === "first-reply" && clock.since, readyAt);
  });

  it("hands the turn back to us when the author updates after our reply", () => {
    const clock = classifyClock({
      createdAt,
      isDraft: false,
      activity: [
        act("builder", at(createdAt, 1)),
        act("author", at(createdAt, 3)),
      ],
      now: new Date(at(createdAt, 4)),
    });
    assert.equal(clock.kind, "our-turn");
  });

  it("ignores bots and other commenters when deciding whose turn it is", () => {
    const clock = classifyClock({
      createdAt,
      isDraft: false,
      activity: [act("bot", at(createdAt, 1)), act("other", at(createdAt, 1))],
      now: new Date(at(createdAt, 1)),
    });
    assert.equal(clock.kind, "first-reply");
  });

  it("moves from waiting to finish to ping by author silence", () => {
    const activity = [act("builder", at(createdAt, 1))];
    const stage = (days: number) => {
      const clock = classifyClock({
        createdAt,
        isDraft: false,
        activity,
        now: new Date(at(createdAt, 1 + days)),
      });
      assert.equal(clock.kind, "their-turn");
      return clock.kind === "their-turn" ? clock.stage : undefined;
    };
    assert.equal(stage(13), "waiting");
    assert.equal(stage(14), "finish");
    assert.equal(stage(30), "ping");
  });

  it("doesn't let our own follow-ups restart the author's silence", () => {
    const asked = at(createdAt, 1);
    const clock = classifyClock({
      createdAt,
      isDraft: false,
      activity: [act("builder", asked), act("builder", at(asked, 20))],
      now: new Date(at(asked, 31)),
    });
    assert.equal(clock.kind === "their-turn" && clock.stage, "ping");
    assert.equal(clock.kind === "their-turn" && clock.silentDays, 31);
  });

  it("puts a reply that ties the author's activity in their court", () => {
    const same = at(createdAt, 2);
    const clock = classifyClock({
      createdAt,
      isDraft: false,
      activity: [act("author", same), act("builder", same)],
      now: new Date(at(createdAt, 3)),
    });
    assert.equal(clock.kind === "their-turn" && clock.askedAt, same);
  });

  it("closes kindly a week after the ping", () => {
    const asked = at(createdAt, 1);
    const pinged = at(asked, 31);
    const clock = classifyClock({
      createdAt,
      isDraft: false,
      activity: [act("builder", asked), act("builder", pinged)],
      now: new Date(at(pinged, 8)),
    });
    assert.equal(clock.kind === "their-turn" && clock.stage, "pinged");
    assert.match(
      describeClock(clock, new Date(at(pinged, 8))),
      /if that was the ping, close kindly/,
    );
    assert.match(
      describeClock(clock, new Date(at(pinged, 3))),
      /if that was the ping, close after \d{4}-\d{2}-\d{2}/,
    );
  });
});

describe("standingReviews", () => {
  it("keeps a changes request until an approval or dismissal lifts it", () => {
    const standing = standingReviews([
      { login: "a", state: "CHANGES_REQUESTED", submittedAt: "2026-10-01" },
      { login: "a", state: "COMMENTED", submittedAt: "2026-10-03" },
      { login: "b", state: "CHANGES_REQUESTED", submittedAt: "2026-10-01" },
      { login: "b", state: "APPROVED", submittedAt: "2026-10-02" },
      { login: "c", state: "CHANGES_REQUESTED", submittedAt: "2026-09-30" },
      { login: "c", state: "DISMISSED", submittedAt: "2026-10-01" },
    ]);
    assert.equal(standing.get("a")?.state, "CHANGES_REQUESTED");
    assert.equal(standing.get("b")?.state, "APPROVED");
    assert.equal(standing.has("c"), false);
  });
});

describe("owners", () => {
  const owners = parseOwnerMap(
    readFileSync(
      new URL("../.agents/skills/review-prs/SKILL.md", import.meta.url),
      "utf8",
    ),
  );

  it("reads the app-owner map from review-prs", () => {
    assert.ok(owners.length >= 3, "review-prs's app-owner map moved");
    assert.ok(
      owners.some((owner) => owner.area === "Content" && owner.login),
      "expected a Content owner with a GitHub login",
    );
    assert.deepEqual(parseOwnerMap("No owner list here."), []);
  });

  it("suggests owners by template area", () => {
    const map = [
      { name: "Shomix", login: "shomix", area: "Clips" },
      { name: "Nicholas", area: "Analytics" },
    ];
    assert.equal(
      suggestOwner(["templates/clips/app/a.ts"], map),
      "Shomix (@shomix) - Clips",
    );
    assert.equal(
      suggestOwner(
        ["templates/clips/app/a.ts", "packages/core/src/b.ts"],
        map,
        () => false,
      ),
      "Shomix (@shomix, not a BuilderIO member) - Clips, plus shared files",
    );
    assert.equal(
      suggestOwner(["packages/core/src/b.ts"], map),
      "Any dev (framework or unowned area)",
    );
  });
});

describe("credit and names", () => {
  it("builds a noreply co-author trailer", () => {
    assert.equal(
      coAuthorTrailer({
        login: "tillkrueger02",
        id: 231084708,
        name: "Till Krüger",
      }),
      "Co-authored-by: Till Krüger <231084708+tillkrueger02@users.noreply.github.com>",
    );
    assert.equal(
      coAuthorTrailer({ login: "x", id: 1, name: null }),
      "Co-authored-by: x <1+x@users.noreply.github.com>",
    );
  });

  it("greets by first name only when the profile has one", () => {
    assert.equal(greetingName("Till Krüger"), "Till");
    assert.equal(greetingName(null), undefined);
    assert.equal(greetingName("  "), undefined);
  });
});

describe("overlapsFor", () => {
  it("names the files two PRs share", () => {
    const overlaps = overlapsFor([
      { number: 1, paths: ["a.ts", "b.ts"] },
      { number: 2, paths: ["b.ts"] },
      { number: 3, paths: ["c.ts"] },
    ]);
    assert.deepEqual([...(overlaps.get(1) ?? [])], [[2, ["b.ts"]]]);
    assert.deepEqual([...(overlaps.get(2) ?? [])], [[1, ["b.ts"]]]);
    assert.equal(overlaps.has(3), false);
  });
});

describe("auditFlags", () => {
  const base = {
    createdAt: "2026-10-01T09:00:00.000Z",
    authorLogin: "contrib",
    isBuilder: (login: string) => ["dev", "lead"].includes(login),
    now: new Date("2026-10-15T09:00:00.000Z"),
  };

  it("flags the reply habits that cost contributors", () => {
    const { flags, firstReplyBusinessDays } = auditFlags({
      ...base,
      state: "MERGED",
      closedAt: "2026-10-09T09:00:00.000Z",
      mergedAt: "2026-10-09T09:00:00.000Z",
      mergeCredits: false,
      activity: [
        act("builder", "2026-10-06T09:00:00.000Z", {
          body: "Thanks @contrib! This is ready for internal approval. cc @lead",
        }),
      ],
    });
    assert.equal(firstReplyBusinessDays, 3);
    assert.deepEqual(flags, [
      "first reply late",
      "internal-process wording",
      "calls the author by @handle",
      "mentions Builder @lead",
      "no Builder comment at merge",
      "squash commit doesn't credit the author",
    ]);
  });

  it("counts a closing comment only around the merge", () => {
    const merged = (replyAt: string) =>
      auditFlags({
        ...base,
        state: "MERGED",
        closedAt: "2026-10-02T15:00:00.000Z",
        mergedAt: "2026-10-02T15:00:00.000Z",
        mergeCredits: true,
        activity: [act("builder", replyAt, { body: "Thanks Sam!" })],
      }).flags;
    assert.deepEqual(merged("2026-10-02T09:00:00.000Z"), [
      "no Builder comment at merge",
    ]);
    assert.deepEqual(merged("2026-10-02T14:30:00.000Z"), []);
    assert.deepEqual(merged("2026-10-02T17:00:00.000Z"), []);
    assert.deepEqual(merged("2026-10-03T16:00:00.000Z"), [
      "no Builder comment at merge",
    ]);
  });

  it("flags our stale closes, not declines or the author's own close", () => {
    const closed = (
      closedAt: string,
      closedByBuilder: boolean,
      activity: Activity[],
    ) =>
      auditFlags({
        ...base,
        state: "CLOSED",
        closedAt,
        mergedAt: null,
        closedByBuilder,
        activity,
      }).flags;
    const asked = [
      act("author", "2026-10-01T09:00:00.000Z"),
      act("builder", "2026-10-02T09:00:00.000Z", { body: "Thanks Sam!" }),
    ];
    assert.deepEqual(closed("2026-10-13T09:00:00.000Z", true, asked), [
      "closed 11d after our ask, with no ping",
    ]);
    assert.deepEqual(closed("2026-10-13T09:00:00.000Z", false, asked), []);
    assert.deepEqual(closed("2026-10-04T09:00:00.000Z", true, asked), [
      "closed 2d after our ask, with no ping",
    ]);
    assert.deepEqual(
      closed("2026-10-02T09:05:00.000Z", true, [
        act("author", "2026-10-01T09:00:00.000Z"),
        act("builder", "2026-10-02T09:00:00.000Z", { body: "Not for now." }),
      ]),
      [],
    );
    assert.deepEqual(
      closed("2026-11-03T09:00:00.000Z", true, [
        ...asked,
        act("builder", "2026-11-01T09:00:00.000Z", { body: "Checking in." }),
      ]),
      ["closed 2d after the ping"],
    );
  });

  it("flags a PR nobody answered", () => {
    assert.deepEqual(
      auditFlags({
        ...base,
        state: "OPEN",
        closedAt: null,
        mergedAt: null,
        activity: [],
      }).flags,
      ["no Builder reply"],
    );
  });

  it("says when it couldn't read every co-author or review comment", () => {
    const { flags } = auditFlags({
      ...base,
      state: "MERGED",
      closedAt: "2026-10-01T10:00:00.000Z",
      mergedAt: "2026-10-01T10:00:00.000Z",
      mergeCredits: "unknown",
      activity: [
        act("builder", "2026-10-01T09:30:00.000Z", {
          kind: "comment",
          body: "merging, thanks Sam!",
        }),
        act("builder", "2026-10-01T09:20:00.000Z", {
          kind: "review",
          partial: true,
        }),
      ],
    });
    assert.deepEqual(flags, [
      "long review read in part; wording flags may miss some",
      "squash commit has more co-authors than read; check credit",
    ]);
  });

  it("times the first reply from when it left draft", () => {
    const { flags, firstReplyBusinessDays } = auditFlags({
      ...base,
      readyAt: "2026-10-05T09:00:00.000Z",
      state: "OPEN",
      closedAt: null,
      mergedAt: null,
      activity: [
        act("builder", "2026-10-02T09:00:00.000Z", { body: "nice start, Sam" }),
        act("builder", "2026-10-09T09:00:00.000Z", { body: "thanks Sam!" }),
      ],
    });
    assert.equal(firstReplyBusinessDays, 4);
    assert.deepEqual(flags, ["first reply late"]);
  });

  it("starts no clock on a PR that has only ever been a draft", () => {
    assert.deepEqual(
      auditFlags({
        ...base,
        everReady: false,
        state: "OPEN",
        closedAt: null,
        mergedAt: null,
        activity: [],
      }).flags,
      [],
    );
  });
});

describe("runCommunityPrsCli", () => {
  type Response = string | Error | ((args: string[]) => string);

  function fakeGh(responses: Record<string, Response>) {
    const calls: string[][] = [];
    const gh = (args: string[]) => {
      calls.push(args);
      const key = args[0] === "api" ? args[1]! : args.join(" ");
      const match = Object.keys(responses)
        .filter((prefix) => key.startsWith(prefix))
        .sort((a, b) => b.length - a.length)[0];
      const response = match === undefined ? undefined : responses[match];
      if (response === undefined) throw new Error(`unexpected gh ${key}`);
      if (response instanceof Error) throw response;
      return typeof response === "function" ? response(args) : response;
    };
    return { gh, calls };
  }

  function notFound(): Error {
    return Object.assign(new Error("gh api failed"), {
      stderr: "gh: Not Found (HTTP 404)",
    });
  }

  const membership = {
    user: "dev\n",
    "user/memberships/orgs/BuilderIO": "active\n",
    "orgs/BuilderIO/members/newcomer": notFound(),
    "orgs/BuilderIO/members/veteran": notFound(),
    "orgs/BuilderIO/members/former": notFound(),
    "orgs/BuilderIO/members/": "",
  };

  function pr(
    number: number,
    login: string,
    createdAt: string,
    extra: Record<string, unknown> = {},
  ) {
    return {
      number,
      title: `PR ${number}`,
      url: `https://github.com/BuilderIO/agent-native/pull/${number}`,
      state: "OPEN",
      isDraft: false,
      createdAt,
      closedAt: null,
      mergedAt: null,
      maintainerCanModify: true,
      mergeable: "MERGEABLE",
      headRefOid: `sha${number}`,
      headRefName: "fix",
      author: { __typename: "User", login },
      headRepository: { nameWithOwner: `${login}/agent-native` },
      assignees: { nodes: [] },
      files: { totalCount: 1, nodes: [{ path: "packages/core/src/x.ts" }] },
      verdicts: { totalCount: 0, nodes: [] },
      mergeCommit: null,
      timelineItems: { nodes: [] },
      updatedAt: (extra.closedAt as string | undefined) ?? createdAt,
      ...extra,
    };
  }

  function openPage(nodes: unknown[]): string {
    return JSON.stringify({
      data: {
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false, endCursor: "" },
            nodes,
          },
        },
      },
    });
  }

  function sweepRows(gh: (args: string[]) => string): string[] {
    let out = "";
    const code = runCommunityPrsCli(["sweep"], {
      gh,
      now: new Date("2026-10-15T09:00:00Z"),
      sleep: () => {},
      stdout: (text) => (out += text),
      stderr: (text) => assert.fail(text),
    });
    assert.equal(code, 0);
    return out.split("\n").filter((line) => line.startsWith("| [#"));
  }

  it("refuses to run when it can't tell members from outsiders", () => {
    const { gh } = fakeGh({
      user: "outsider\n",
      "user/memberships/orgs/BuilderIO": notFound(),
    });
    const errors: string[] = [];
    const code = runCommunityPrsCli(["sweep"], {
      gh,
      stdout: () => assert.fail("printed a sweep it could not verify"),
      stderr: (text) => errors.push(text),
    });
    assert.equal(code, 2);
    assert.match(errors.join(""), /can't verify BuilderIO membership/);
  });

  it("sweeps outside PRs longest-waiting first and never writes", () => {
    const { gh, calls } = fakeGh({
      ...membership,
      graphql: openPage([
        pr(10, "newcomer", "2026-10-13T09:00:00Z"),
        pr(11, "veteran", "2026-10-01T09:00:00Z"),
        pr(12, "teammate", "2026-09-01T09:00:00Z"),
        pr(13, "former", "2026-09-01T09:00:00Z", {
          headRepository: { nameWithOwner: "BuilderIO/agent-native" },
        }),
      ]),
      "repos/BuilderIO/agent-native/actions/runs": "sha11\n",
    });
    const rows = sweepRows(gh);
    assert.deepEqual(
      rows.map((row) => row.match(/\[#(\d+)\]/)?.[1]),
      ["11", "10"],
    );
    assert.match(rows[0]!, /First reply overdue/);
    assert.match(rows[0]!, /1 workflow runs await approval/);
    for (const call of calls) {
      assert.ok(
        !call.some((arg) => /^(-X|--method)$/.test(arg)) &&
          !call.some((arg) =>
            /^mutation\b/.test(arg.replace(/^query=\s*/, "")),
          ),
        `wrote to GitHub: gh ${call.join(" ")}`,
      );
    }
  });

  it("reads a busy PR's older timeline before judging whose turn it is", () => {
    const olderPage = JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            timelineItems: {
              pageInfo: { hasPreviousPage: false, startCursor: "c0" },
              nodes: [
                {
                  __typename: "IssueComment",
                  createdAt: "2026-10-02T09:00:00Z",
                  url: "https://github.com/BuilderIO/agent-native/pull/20#c",
                  author: { __typename: "User", login: "dev" },
                },
              ],
            },
          },
        },
      },
    });
    const { gh } = fakeGh({
      ...membership,
      graphql: (args) =>
        args.some((arg) => arg.includes("$before"))
          ? olderPage
          : openPage([
              pr(20, "veteran", "2026-10-01T09:00:00Z", {
                mergeable: "UNKNOWN",
                timelineItems: {
                  pageInfo: { hasPreviousPage: true, startCursor: "c1" },
                  nodes: [],
                },
              }),
            ]),
      "repos/BuilderIO/agent-native/actions/runs": "",
    });
    const [row] = sweepRows(gh);
    assert.match(row!, /We replied last \(13d ago\)/);
    assert.match(row!, /2026-10-02 @dev/);
    assert.match(row!, /conflicts unknown/);
  });

  it("dates a commit by when it was pushed, not when it was made", () => {
    const { gh } = fakeGh({
      ...membership,
      graphql: openPage([
        pr(21, "veteran", "2026-10-01T09:00:00Z", {
          timelineItems: {
            nodes: [
              {
                __typename: "IssueComment",
                createdAt: "2026-10-05T09:00:00Z",
                author: { __typename: "User", login: "dev" },
              },
              {
                __typename: "PullRequestCommit",
                commit: {
                  committedDate: "2026-10-04T09:00:00Z",
                  checkSuites: {
                    nodes: [{ createdAt: "2026-10-13T09:00:00Z" }],
                  },
                  authors: { nodes: [{ user: { login: "veteran" } }] },
                },
              },
            ],
          },
        }),
      ]),
      "repos/BuilderIO/agent-native/actions/runs": "",
    });
    const [row] = sweepRows(gh);
    assert.match(row!, /Our turn/);
    assert.match(row!, /\| 2026-10-13 \|/);
  });

  it("reports one PR's checks and what it couldn't read", () => {
    const detail = pr(22, "veteran", "2026-10-01T09:00:00Z", {
      files: { totalCount: 150, nodes: [{ path: "templates/clips/a.ts" }] },
      closingIssuesReferences: { nodes: [] },
      commits: {
        nodes: [
          {
            commit: {
              statusCheckRollup: {
                contexts: {
                  totalCount: 4,
                  nodes: [
                    {
                      __typename: "CheckRun",
                      name: "build",
                      status: "COMPLETED",
                      conclusion: "SUCCESS",
                    },
                    {
                      __typename: "CheckRun",
                      name: "e2e",
                      status: "COMPLETED",
                      conclusion: "CANCELLED",
                    },
                    {
                      __typename: "CheckRun",
                      name: "lint",
                      status: "IN_PROGRESS",
                      conclusion: null,
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    });
    const { gh } = fakeGh({
      ...membership,
      graphql: (args) =>
        args.some((arg) => arg.includes("pullRequests(states: OPEN"))
          ? openPage([detail])
          : JSON.stringify({ data: { repository: { pullRequest: detail } } }),
      "users/veteran": JSON.stringify({
        id: 7,
        login: "veteran",
        name: "Vera Teran",
        company: null,
        blog: null,
        bio: null,
        html_url: "https://github.com/veteran",
      }),
      "pr list": "[]",
      "repos/BuilderIO/agent-native/actions/runs": "",
    });
    let out = "";
    const code = runCommunityPrsCli(["pr", "22"], {
      gh,
      now: new Date("2026-10-15T09:00:00Z"),
      sleep: () => {},
      stdout: (text) => (out += text),
      stderr: (text) => assert.fail(text),
    });
    assert.equal(code, 0);
    assert.match(
      out,
      /Checks: 4 reported, 0 failing, 1 cancelled, stale, or awaiting approval \(e2e\), 1 pending; read 3 of 4/,
    );
    assert.match(out, /owner and overlaps cover 1 of 150 files/);
    assert.match(out, /greet as Vera/);
  });

  it("audits without clocking drafts or trusting mentions from other repos", () => {
    const draft = pr(30, "veteran", "2026-10-01T09:00:00Z", { isDraft: true });
    const merged = (number: number, credited: boolean) => ({
      __typename: "PullRequest",
      number,
      merged: true,
      mergedAt: "2026-10-10T08:00:00Z",
      author: { __typename: "User", login: "dev" },
      mergeCommit: {
        authors: { nodes: credited ? [{ user: { login: "veteran" } }] : [] },
      },
    });
    const closedAfter = (number: number, reference: unknown) =>
      pr(number, "veteran", "2026-10-01T09:00:00Z", {
        state: "CLOSED",
        closedAt: "2026-10-10T09:00:00Z",
        timelineItems: {
          nodes: [
            {
              __typename: "IssueComment",
              createdAt: "2026-10-01T12:00:00Z",
              body: "thanks Vera! could you add a test?",
              author: { __typename: "User", login: "dev" },
            },
            reference,
            {
              __typename: "ClosedEvent",
              createdAt: "2026-10-10T09:00:00Z",
              actor: { __typename: "User", login: "dev" },
            },
          ],
        },
      });
    const mentioned = closedAfter(31, {
      __typename: "CrossReferencedEvent",
      createdAt: "2026-10-10T08:00:00Z",
      isCrossRepository: true,
      source: merged(99, false),
    });
    const crowded = pr(33, "veteran", "2026-10-01T09:00:00Z", {
      state: "MERGED",
      closedAt: "2026-10-05T09:00:00Z",
      mergedAt: "2026-10-05T09:00:00Z",
      mergeCommit: {
        oid: "m33",
        authors: { totalCount: 60, nodes: [{ user: { login: "someone" } }] },
      },
    });
    // Search matches whole days; this one changed before the window opened.
    const earlier = pr(34, "veteran", "2026-09-20T09:00:00Z", {
      updatedAt: "2026-10-01T08:00:00Z",
    });
    const rebuilt = closedAfter(32, {
      __typename: "CrossReferencedEvent",
      createdAt: "2026-10-10T08:00:00Z",
      isCrossRepository: false,
      source: merged(40, true),
    });
    const { gh } = fakeGh({
      ...membership,
      graphql: (args) =>
        args.some((arg) => arg.includes("search("))
          ? JSON.stringify({
              data: {
                search: {
                  issueCount: 5,
                  pageInfo: { hasNextPage: false, endCursor: "" },
                  nodes: [draft, mentioned, rebuilt, crowded, earlier],
                },
              },
            })
          : JSON.stringify({
              data: {
                repository: {
                  pr30: draft,
                  pr31: mentioned,
                  pr32: rebuilt,
                  pr33: crowded,
                  pr34: earlier,
                },
              },
            }),
    });
    let out = "";
    const code = runCommunityPrsCli(["audit", "--days=14"], {
      gh,
      now: new Date("2026-10-15T09:00:00Z"),
      stdout: (text) => (out += text),
      stderr: (text) => assert.fail(text),
    });
    assert.equal(code, 0);
    const rows = out.split("\n").filter((line) => line.startsWith("| [#"));
    assert.match(rows[0]!, /^\| \[#30\].*\| - \|$/);
    assert.match(rows[1]!, /closed 8d after our ask, with no ping/);
    assert.doesNotMatch(rows[1]!, /#99/);
    // A mention can't prove the close was for a rebuild, so both stay.
    assert.match(rows[2]!, /closed 8d after our ask, with no ping/);
    assert.match(rows[2]!, /may have landed via #40, which credits the author/);
    assert.match(rows[3]!, /squash commit has more co-authors than read/);
    assert.equal(rows.length, 4);
  });

  it("rejects options it can't read instead of widening the report", () => {
    for (const args of [
      ["audit", "--days"],
      ["audit", "--by", "--json"],
      ["audit", "--dayz", "7"],
      ["audit", "--dayz=7"],
      ["audit", "--days=0"],
      ["audit", "extra"],
      ["sweep", "--days", "7"],
      ["pr", "12", "13"],
      ["pr", "#12"],
    ]) {
      let err = "";
      const code = runCommunityPrsCli(args, {
        gh: () => assert.fail(`ran gh for ${args.join(" ")}`),
        stdout: (text) => assert.fail(text),
        stderr: (text) => (err += text),
      });
      assert.equal(code, 2, args.join(" "));
      assert.match(err, /Usage:/, args.join(" "));
    }
  });
});
