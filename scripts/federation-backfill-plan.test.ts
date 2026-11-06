import assert from "node:assert/strict";
import test from "node:test";

import {
  type AppSnapshot,
  type BackfillMember,
  type BackfillOrg,
  buildBackfillPlan,
  rosterHash,
} from "./federation-backfill-plan.js";

const AUTHORITY = "https://hub.example.test";
const HUB = "dispatch";
const ALICE = "alice@example.test";
const BOB = "bob@example.test";
const CAROL = "carol@example.test";
const DAVE = "dave@example.test";

function id(char: string): string {
  return char.repeat(32);
}

function org(
  fields: Pick<BackfillOrg, "id" | "name" | "createdAt"> & Partial<BackfillOrg>,
): BackfillOrg {
  return {
    allowedDomain: null,
    identityAuthority: null,
    identityId: null,
    ...fields,
  };
}

function member(orgId: string, email: string, role: string): BackfillMember {
  return { orgId, email, role };
}

function snapshot(
  app: string,
  orgs: BackfillOrg[] = [],
  members: BackfillMember[] = [],
): AppSnapshot {
  return { app, orgs, members };
}

function plan(snapshots: AppSnapshot[]) {
  return buildBackfillPlan(snapshots, { authority: AUTHORITY });
}

function byApp<T extends { app: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.app.localeCompare(b.app));
}

function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function reversedSnapshot(source: AppSnapshot): AppSnapshot {
  return {
    app: source.app,
    orgs: [...source.orgs].reverse(),
    members: [...source.members].reverse(),
  };
}

function determinismFixture(): AppSnapshot[] {
  return [
    snapshot(
      HUB,
      [org({ id: id("9"), name: "Hub team", createdAt: 90 })],
      [member(id("9"), ALICE, "owner"), member(id("9"), CAROL, "member")],
    ),
    snapshot(
      "design",
      [
        org({ id: id("1"), name: "Alice design", createdAt: 100 }),
        org({ id: id("3"), name: "Bob team", createdAt: 300 }),
        org({
          id: id("4"),
          name: "Domain",
          createdAt: 400,
          allowedDomain: "example.test",
        }),
        org({ id: id("5"), name: "Empty", createdAt: 500 }),
      ],
      [
        member(id("1"), ALICE, "owner"),
        member(id("3"), ALICE, "owner"),
        member(id("3"), BOB, "member"),
        member(id("3"), CAROL, "member"),
        member(id("4"), BOB, "owner"),
      ],
    ),
    snapshot(
      "slides",
      [
        org({ id: id("2"), name: "Alice slides", createdAt: 200 }),
        org({ id: id("6"), name: "Carol solo", createdAt: 150 }),
        org({ id: id("7"), name: "Bob and Dave", createdAt: 250 }),
        org({ id: id("8"), name: "Bad role", createdAt: 260 }),
      ],
      [
        member(id("2"), ALICE, "owner"),
        member(id("6"), CAROL, "owner"),
        member(id("7"), BOB, "owner"),
        member(id("7"), DAVE, "member"),
        member(id("8"), DAVE, "creator"),
      ],
    ),
    snapshot(
      "assets",
      [
        org({ id: id("a"), name: "Carol assets", createdAt: 50 }),
        org({ id: id("b"), name: "Carol assets again", createdAt: 60 }),
      ],
      [member(id("a"), CAROL, "owner"), member(id("b"), CAROL, "owner")],
    ),
  ];
}

test("one person with one-person orgs in three apps is created once under the earliest org", () => {
  const result = plan([
    snapshot(HUB),
    snapshot(
      "assets",
      [org({ id: id("1"), name: "Assets", createdAt: 100 })],
      [member(id("1"), ALICE, "owner")],
    ),
    snapshot(
      "slides",
      [org({ id: id("2"), name: "Slides", createdAt: 200 })],
      [member(id("2"), ALICE, "owner")],
    ),
    snapshot(
      "design",
      [org({ id: id("3"), name: "Design", createdAt: 300 })],
      [member(id("3"), ALICE, "owner")],
    ),
  ]);

  assert.deepStrictEqual(result.hubCreates, [
    {
      id: id("1"),
      name: "Assets",
      createdBy: ALICE,
      createdAt: 100,
      members: [{ email: ALICE, role: "owner" }],
    },
  ]);
  assert.deepStrictEqual(byApp(result.appLinks), [
    { app: "assets", orgId: id("1"), canonicalId: id("1") },
    { app: "design", orgId: id("3"), canonicalId: id("1") },
    { app: "slides", orgId: id("2"), canonicalId: id("1") },
  ]);
});

test("a dispatch one-person org becomes the canonical id and no hub org is created", () => {
  const result = plan([
    snapshot(
      HUB,
      [org({ id: id("4"), name: "Dispatch", createdAt: 500 })],
      [member(id("4"), ALICE, "owner")],
    ),
    snapshot(
      "assets",
      [org({ id: id("1"), name: "Assets", createdAt: 100 })],
      [member(id("1"), ALICE, "owner")],
    ),
    snapshot(
      "slides",
      [org({ id: id("2"), name: "Slides", createdAt: 200 })],
      [member(id("2"), ALICE, "owner")],
    ),
    snapshot(
      "design",
      [org({ id: id("3"), name: "Design", createdAt: 300 })],
      [member(id("3"), ALICE, "owner")],
    ),
  ]);

  assert.deepStrictEqual(result.hubCreates, []);
  assert.deepStrictEqual(byApp(result.appLinks), [
    { app: "assets", orgId: id("1"), canonicalId: id("4") },
    { app: "design", orgId: id("3"), canonicalId: id("4") },
    { app: "dispatch", orgId: id("4"), canonicalId: id("4") },
    { app: "slides", orgId: id("2"), canonicalId: id("4") },
  ]);
});

test("a person with two one-person orgs in the same app links only the earliest", () => {
  const result = plan([
    snapshot(HUB),
    snapshot(
      "design",
      [
        org({ id: id("5"), name: "First", createdAt: 100 }),
        org({ id: id("6"), name: "Second", createdAt: 200 }),
      ],
      [member(id("5"), BOB, "owner"), member(id("6"), BOB, "owner")],
    ),
  ]);

  assert.deepStrictEqual(result.appLinks, [
    { app: "design", orgId: id("5"), canonicalId: id("5") },
  ]);
  assert.deepStrictEqual(result.skipped, [
    { app: "design", orgId: id("6"), reason: "duplicate-in-app" },
  ]);
});

test("orgs with a domain, an existing identity, or a non-hex id are skipped", () => {
  const result = plan([
    snapshot(HUB),
    snapshot(
      "design",
      [
        org({
          id: id("7"),
          name: "Domain org",
          createdAt: 100,
          allowedDomain: "example.test",
        }),
        org({
          id: id("8"),
          name: "Linked org",
          createdAt: 200,
          identityAuthority: AUTHORITY,
        }),
        org({ id: "not-a-hex-id", name: "Odd id", createdAt: 300 }),
      ],
      [
        member(id("7"), ALICE, "owner"),
        member(id("8"), ALICE, "owner"),
        member("not-a-hex-id", ALICE, "owner"),
      ],
    ),
  ]);

  assert.deepStrictEqual(result.skipped, [
    { app: "design", orgId: id("7"), reason: "has-domain" },
    { app: "design", orgId: id("8"), reason: "already-linked" },
    { app: "design", orgId: "not-a-hex-id", reason: "non-standard-id" },
  ]);
  assert.deepStrictEqual(result.appLinks, []);
  assert.deepStrictEqual(result.hubCreates, []);
});

test("orgs with no members, no owner, or an unknown role are skipped", () => {
  const result = plan([
    snapshot(HUB),
    snapshot(
      "design",
      [
        org({ id: id("a"), name: "No members", createdAt: 100 }),
        org({ id: id("b"), name: "No owner", createdAt: 200 }),
        org({ id: id("c"), name: "Bad role", createdAt: 300 }),
      ],
      [member(id("b"), ALICE, "admin"), member(id("c"), BOB, "creator")],
    ),
  ]);

  assert.deepStrictEqual(result.skipped, [
    { app: "design", orgId: id("a"), reason: "no-members" },
    { app: "design", orgId: id("b"), reason: "no-owner" },
    { app: "design", orgId: id("c"), reason: "invalid-role" },
  ]);
  assert.deepStrictEqual(result.appLinks, []);
  assert.deepStrictEqual(result.hubCreates, []);
});

test("a multi-person org keeps its own id, with owner as creator and members sorted by email", () => {
  const result = plan([
    snapshot(HUB),
    snapshot(
      "design",
      [org({ id: id("d"), name: "Team", createdAt: 100 })],
      [member(id("d"), BOB, "member"), member(id("d"), ALICE, "owner")],
    ),
  ]);

  assert.deepStrictEqual(result.hubCreates, [
    {
      id: id("d"),
      name: "Team",
      createdBy: ALICE,
      createdAt: 100,
      members: [
        { email: ALICE, role: "owner" },
        { email: BOB, role: "member" },
      ],
    },
  ]);
  assert.deepStrictEqual(result.appLinks, [
    { app: "design", orgId: id("d"), canonicalId: id("d") },
  ]);
});

test("a multi-person org that lives in dispatch gets no hub create and one self link", () => {
  const result = plan([
    snapshot(
      HUB,
      [org({ id: id("e"), name: "Hub team", createdAt: 100 })],
      [member(id("e"), ALICE, "owner"), member(id("e"), BOB, "member")],
    ),
  ]);

  assert.deepStrictEqual(result.hubCreates, []);
  assert.deepStrictEqual(result.appLinks, [
    { app: "dispatch", orgId: id("e"), canonicalId: id("e") },
  ]);
});

test("hub-id-conflict skips every org in a one-person group whose canonical id is already a hub org", () => {
  const result = plan([
    snapshot(
      HUB,
      [org({ id: id("1"), name: "Carol hub", createdAt: 10 })],
      [member(id("1"), CAROL, "owner")],
    ),
    snapshot(
      "design",
      [org({ id: id("1"), name: "Alice design", createdAt: 100 })],
      [member(id("1"), ALICE, "owner")],
    ),
    snapshot(
      "slides",
      [org({ id: id("2"), name: "Alice slides", createdAt: 200 })],
      [member(id("2"), ALICE, "owner")],
    ),
  ]);

  assert.deepStrictEqual(result.skipped, [
    { app: "design", orgId: id("1"), reason: "hub-id-conflict" },
    { app: "slides", orgId: id("2"), reason: "hub-id-conflict" },
  ]);
  assert.deepStrictEqual(result.hubCreates, []);
  assert.deepStrictEqual(result.appLinks, [
    { app: "dispatch", orgId: id("1"), canonicalId: id("1") },
  ]);
});

test("hub-id-conflict skips a multi-person org whose own id is already a hub org", () => {
  const result = plan([
    snapshot(
      HUB,
      [org({ id: id("f"), name: "Carol hub", createdAt: 10 })],
      [member(id("f"), CAROL, "owner")],
    ),
    snapshot(
      "design",
      [org({ id: id("f"), name: "Team", createdAt: 100 })],
      [member(id("f"), ALICE, "owner"), member(id("f"), BOB, "member")],
    ),
  ]);

  assert.deepStrictEqual(result.skipped, [
    { app: "design", orgId: id("f"), reason: "hub-id-conflict" },
  ]);
  assert.deepStrictEqual(result.hubCreates, []);
  assert.deepStrictEqual(result.appLinks, [
    { app: "dispatch", orgId: id("f"), canonicalId: id("f") },
  ]);
});

test("the same team across two apps forms one same-team group, but not when it repeats inside one app", () => {
  const crossApp = plan([
    snapshot(HUB),
    snapshot(
      "design",
      [org({ id: id("1"), name: "Design team", createdAt: 100 })],
      [member(id("1"), ALICE, "owner"), member(id("1"), BOB, "member")],
    ),
    snapshot(
      "slides",
      [org({ id: id("2"), name: "Slides team", createdAt: 200 })],
      [
        member(id("2"), "BOB@example.test", "member"),
        member(id("2"), "ALICE@example.test", "owner"),
      ],
    ),
  ]);

  assert.deepStrictEqual(crossApp.sameTeamAcrossApps, [
    {
      orgs: [
        { app: "design", orgId: id("1") },
        { app: "slides", orgId: id("2") },
      ],
    },
  ]);

  const oneApp = plan([
    snapshot(HUB),
    snapshot(
      "design",
      [
        org({ id: id("1"), name: "Team one", createdAt: 100 }),
        org({ id: id("2"), name: "Team two", createdAt: 200 }),
      ],
      [
        member(id("1"), ALICE, "owner"),
        member(id("1"), BOB, "member"),
        member(id("2"), ALICE, "owner"),
        member(id("2"), BOB, "member"),
      ],
    ),
  ]);

  assert.deepStrictEqual(oneApp.sameTeamAcrossApps, []);
  assert.deepStrictEqual(oneApp.appLinks, [
    { app: "design", orgId: id("1"), canonicalId: id("1") },
    { app: "design", orgId: id("2"), canonicalId: id("2") },
  ]);
});

test("member emails match case-insensitively and duplicates collapse, so the org stays one-person", () => {
  const result = plan([
    snapshot(HUB),
    snapshot(
      "design",
      [org({ id: id("1"), name: "Solo", createdAt: 100 })],
      [
        member(id("1"), "ALICE@example.test", "owner"),
        member(id("1"), "alice@example.test", "owner"),
      ],
    ),
  ]);

  assert.deepStrictEqual(result.hubCreates, [
    {
      id: id("1"),
      name: "Solo",
      createdBy: ALICE,
      createdAt: 100,
      members: [{ email: ALICE, role: "owner" }],
    },
  ]);
  assert.deepStrictEqual(result.appLinks, [
    { app: "design", orgId: id("1"), canonicalId: id("1") },
  ]);
  assert.equal(result.counts.onePersonOrgsLinked, 1);
  assert.equal(result.counts.multiPersonOrgsLinked, 0);
});

test("shuffling snapshots, orgs and members yields the same plan", () => {
  const snapshots = determinismFixture();
  const shuffled = [...snapshots].reverse().map(reversedSnapshot);

  assert.deepStrictEqual(roundTrip(plan(shuffled)), roundTrip(plan(snapshots)));
});

test("counts summarize people, orgs, creates, links, and skips exactly", () => {
  const result = plan([
    snapshot(HUB),
    snapshot(
      "design",
      [
        org({ id: id("1"), name: "Alice design", createdAt: 100 }),
        org({ id: id("4"), name: "Shared", createdAt: 400 }),
        org({
          id: id("5"),
          name: "Domain",
          createdAt: 500,
          allowedDomain: "example.test",
        }),
      ],
      [
        member(id("1"), ALICE, "owner"),
        member(id("4"), ALICE, "owner"),
        member(id("4"), BOB, "member"),
        member(id("5"), ALICE, "owner"),
      ],
    ),
    snapshot(
      "slides",
      [
        org({ id: id("2"), name: "Alice slides", createdAt: 200 }),
        org({ id: id("6"), name: "Empty", createdAt: 600 }),
      ],
      [member(id("2"), ALICE, "owner")],
    ),
    snapshot(
      "assets",
      [org({ id: id("3"), name: "Bob assets", createdAt: 300 })],
      [member(id("3"), BOB, "owner")],
    ),
  ]);

  assert.equal(result.counts.peopleLinked, 2);
  assert.equal(result.counts.onePersonOrgsLinked, 3);
  assert.equal(result.counts.multiPersonOrgsLinked, 1);
  assert.equal(result.counts.hubCreates, 3);
  assert.deepStrictEqual(result.counts.appLinksByApp, {
    design: 2,
    slides: 1,
    assets: 1,
  });
  assert.deepStrictEqual(result.counts.skippedByReason, {
    "has-domain": 1,
    "no-members": 1,
  });
});

test("buildBackfillPlan throws when there is no dispatch snapshot", () => {
  assert.throws(
    () => plan([snapshot("design")]),
    /The dispatch snapshot is required\./,
  );
});

test("the plan's app links, skips, and same-team groups contain no emails", () => {
  const result = plan([
    snapshot(HUB),
    snapshot(
      "design",
      [
        org({ id: id("1"), name: "Team", createdAt: 100 }),
        org({
          id: id("2"),
          name: "Domain",
          createdAt: 200,
          allowedDomain: "example.test",
        }),
      ],
      [
        member(id("1"), ALICE, "owner"),
        member(id("1"), BOB, "member"),
        member(id("2"), CAROL, "owner"),
      ],
    ),
    snapshot(
      "slides",
      [
        org({ id: id("3"), name: "Team again", createdAt: 300 }),
        org({ id: id("4"), name: "No owner", createdAt: 400 }),
      ],
      [
        member(id("3"), BOB, "member"),
        member(id("3"), ALICE, "owner"),
        member(id("4"), DAVE, "member"),
      ],
    ),
  ]);

  const json = JSON.stringify({
    appLinks: result.appLinks,
    skipped: result.skipped,
    sameTeamAcrossApps: result.sameTeamAcrossApps,
  });
  for (const email of [ALICE, BOB, CAROL, DAVE]) {
    assert.equal(json.includes(email), false, `leaked ${email}`);
  }
});

test("a rerun after a full apply plans nothing", () => {
  const fixture: AppSnapshot[] = [
    snapshot(HUB),
    snapshot(
      "design",
      [
        org({ id: id("1"), name: "Alice design", createdAt: 100 }),
        org({ id: id("2"), name: "Alice design again", createdAt: 200 }),
        org({ id: id("3"), name: "Team", createdAt: 300 }),
      ],
      [
        member(id("1"), ALICE, "owner"),
        member(id("2"), ALICE, "owner"),
        member(id("3"), BOB, "owner"),
        member(id("3"), CAROL, "member"),
      ],
    ),
    snapshot(
      "slides",
      [org({ id: id("4"), name: "Alice slides", createdAt: 150 })],
      [member(id("4"), ALICE, "owner")],
    ),
  ];

  const first = plan(fixture);
  assert.deepStrictEqual(
    first.hubCreates.map((create) => create.id),
    [id("1"), id("3")],
  );
  assert.deepStrictEqual(first.skipped, [
    { app: "design", orgId: id("2"), reason: "duplicate-in-app" },
  ]);

  const canonicalByOrg = new Map<string, string>();
  for (const link of first.appLinks) {
    canonicalByOrg.set(`${link.app}\n${link.orgId}`, link.canonicalId);
  }
  const markLinked = (source: AppSnapshot): AppSnapshot => ({
    app: source.app,
    members: source.members,
    orgs: source.orgs.map((row) => {
      const canonicalId = canonicalByOrg.get(`${source.app}\n${row.id}`);
      return canonicalId === undefined
        ? row
        : { ...row, identityAuthority: AUTHORITY, identityId: canonicalId };
    }),
  });
  const appliedHub: AppSnapshot = {
    app: HUB,
    orgs: first.hubCreates.map((create) =>
      org({
        id: create.id,
        name: create.name,
        createdAt: create.createdAt,
        identityAuthority: AUTHORITY,
        identityId: create.id,
      }),
    ),
    members: first.hubCreates.flatMap((create) =>
      create.members.map((entry) => member(create.id, entry.email, entry.role)),
    ),
  };
  const applied = [
    appliedHub,
    ...fixture.filter((source) => source.app !== HUB).map(markLinked),
  ];

  const rerun = plan(applied);
  assert.deepStrictEqual(rerun.appLinks, []);
  assert.deepStrictEqual(rerun.hubCreates, []);
  assert.equal(rerun.counts.peopleLinked, 0);
  assert.deepStrictEqual(rerun.skipped, [
    { app: "design", orgId: id("1"), reason: "already-linked" },
    { app: "design", orgId: id("2"), reason: "duplicate-in-app" },
    { app: "design", orgId: id("3"), reason: "already-linked" },
    { app: "dispatch", orgId: id("1"), reason: "already-linked" },
    { app: "dispatch", orgId: id("3"), reason: "already-linked" },
    { app: "slides", orgId: id("4"), reason: "already-linked" },
  ]);
});

test("a new workspace for an already-linked person joins their existing shared id", () => {
  const CANON = id("c");
  const result = plan([
    snapshot(HUB),
    snapshot(
      "design",
      [
        org({
          id: id("1"),
          name: "Alice design",
          createdAt: 100,
          identityAuthority: AUTHORITY,
          identityId: CANON,
        }),
      ],
      [member(id("1"), ALICE, "owner")],
    ),
    snapshot(
      "slides",
      [org({ id: id("2"), name: "Alice slides", createdAt: 200 })],
      [member(id("2"), ALICE, "owner")],
    ),
  ]);

  assert.deepStrictEqual(result.appLinks, [
    { app: "slides", orgId: id("2"), canonicalId: CANON },
  ]);
  assert.deepStrictEqual(result.hubCreates, []);
});

test("a second workspace in an app where the person is already linked stays unlinked", () => {
  const CANON = id("c");
  const result = plan([
    snapshot(HUB),
    snapshot(
      "design",
      [
        org({
          id: id("1"),
          name: "Alice design",
          createdAt: 100,
          identityAuthority: AUTHORITY,
          identityId: CANON,
        }),
        org({ id: id("2"), name: "Alice design again", createdAt: 200 }),
      ],
      [member(id("1"), ALICE, "owner"), member(id("2"), ALICE, "owner")],
    ),
  ]);

  assert.deepStrictEqual(result.appLinks, []);
  assert.deepStrictEqual(result.hubCreates, []);
  assert.deepStrictEqual(result.skipped, [
    { app: "design", orgId: id("1"), reason: "already-linked" },
    { app: "design", orgId: id("2"), reason: "duplicate-in-app" },
  ]);
});

test("a new dispatch workspace for a person who already has a shared id is skipped", () => {
  const CANON = id("c");
  const result = plan([
    snapshot(
      HUB,
      [org({ id: id("4"), name: "Alice dispatch", createdAt: 300 })],
      [member(id("4"), ALICE, "owner")],
    ),
    snapshot(
      "design",
      [
        org({
          id: id("1"),
          name: "Alice design",
          createdAt: 100,
          identityAuthority: AUTHORITY,
          identityId: CANON,
        }),
      ],
      [member(id("1"), ALICE, "owner")],
    ),
  ]);

  assert.deepStrictEqual(result.appLinks, []);
  assert.deepStrictEqual(result.hubCreates, []);
  assert.deepStrictEqual(result.skipped, [
    { app: "design", orgId: id("1"), reason: "already-linked" },
    { app: "dispatch", orgId: id("4"), reason: "duplicate-in-app" },
  ]);
});

test("an org linked to a different authority does not reserve a slot", () => {
  const result = plan([
    snapshot(HUB),
    snapshot(
      "design",
      [
        org({
          id: id("1"),
          name: "Alice design",
          createdAt: 100,
          identityAuthority: "https://other-hub.example.test",
          identityId: id("c"),
        }),
      ],
      [member(id("1"), ALICE, "owner")],
    ),
    snapshot(
      "slides",
      [org({ id: id("2"), name: "Alice slides", createdAt: 200 })],
      [member(id("2"), ALICE, "owner")],
    ),
  ]);

  assert.deepStrictEqual(result.skipped, [
    { app: "design", orgId: id("1"), reason: "already-linked" },
  ]);
  assert.deepStrictEqual(result.hubCreates, [
    {
      id: id("2"),
      name: "Alice slides",
      createdBy: ALICE,
      createdAt: 200,
      members: [{ email: ALICE, role: "owner" }],
    },
  ]);
  assert.deepStrictEqual(result.appLinks, [
    { app: "slides", orgId: id("2"), canonicalId: id("2") },
  ]);
});

test("an interrupted multi-person apply is resumed without a second hub row", () => {
  const CANON = id("c");
  const result = plan([
    snapshot(
      HUB,
      [
        org({
          id: CANON,
          name: "Team",
          createdAt: 100,
          identityAuthority: AUTHORITY,
          identityId: CANON,
        }),
      ],
      [member(CANON, ALICE, "owner"), member(CANON, BOB, "member")],
    ),
    snapshot(
      "design",
      [org({ id: CANON, name: "Team", createdAt: 100 })],
      [member(CANON, BOB, "member"), member(CANON, ALICE, "owner")],
    ),
  ]);

  assert.deepStrictEqual(result.hubCreates, []);
  assert.deepStrictEqual(result.appLinks, [
    { app: "design", orgId: CANON, canonicalId: CANON },
  ]);
  assert.deepStrictEqual(result.skipped, [
    { app: HUB, orgId: CANON, reason: "already-linked" },
  ]);
  assert.equal(result.counts.multiPersonOrgsLinked, 1);
});

test("a hub row with a different roster is still a conflict", () => {
  const CANON = id("c");
  const result = plan([
    snapshot(
      HUB,
      [
        org({
          id: CANON,
          name: "Team",
          createdAt: 100,
          identityAuthority: AUTHORITY,
          identityId: CANON,
        }),
      ],
      [member(CANON, ALICE, "owner")],
    ),
    snapshot(
      "design",
      [org({ id: CANON, name: "Team", createdAt: 100 })],
      [member(CANON, ALICE, "owner"), member(CANON, BOB, "member")],
    ),
  ]);

  assert.deepStrictEqual(result.hubCreates, []);
  assert.deepStrictEqual(result.appLinks, []);
  assert.deepStrictEqual(result.skipped, [
    { app: "design", orgId: CANON, reason: "hub-id-conflict" },
    { app: HUB, orgId: CANON, reason: "already-linked" },
  ]);
});

test("a hub row not mapped to the authority is still a conflict", () => {
  const CANON = id("c");
  const hubRows = [
    org({ id: CANON, name: "Team", createdAt: 100 }),
    org({
      id: CANON,
      name: "Team",
      createdAt: 100,
      identityAuthority: "https://other-hub.example.test",
      identityId: CANON,
    }),
  ];

  for (const hubRow of hubRows) {
    const result = plan([
      snapshot(
        HUB,
        [hubRow],
        [member(CANON, ALICE, "owner"), member(CANON, BOB, "member")],
      ),
      snapshot(
        "design",
        [org({ id: CANON, name: "Team", createdAt: 100 })],
        [member(CANON, ALICE, "owner"), member(CANON, BOB, "member")],
      ),
    ]);

    assert.deepStrictEqual(result.hubCreates, []);
    assert.deepStrictEqual(
      result.appLinks.filter((link) => link.app === "design"),
      [],
    );
    assert.ok(
      result.skipped.some(
        (entry) =>
          entry.app === "design" &&
          entry.orgId === CANON &&
          entry.reason === "hub-id-conflict",
      ),
    );
  }
});

test("rosterHash is stable across email case and order and changes when a role changes", () => {
  const roster = [
    { email: ALICE, role: "owner" },
    { email: BOB, role: "member" },
  ];
  const reordered = [
    { email: " BOB@example.test ", role: "member" },
    { email: "Alice@Example.test", role: "owner" },
  ];
  const promoted = [
    { email: ALICE, role: "admin" },
    { email: BOB, role: "member" },
  ];

  assert.equal(rosterHash(reordered), rosterHash(roster));
  assert.match(rosterHash(roster), /^[0-9a-f]{64}$/);
  assert.notEqual(rosterHash(promoted), rosterHash(roster));
});
