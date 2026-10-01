import assert from "node:assert/strict";
import test from "node:test";

import {
  builderConnectionDisagreements,
  crossedLanes,
  describeNavigations,
  diagnoseCredentialState,
  findBlockingText,
  findStuckDesignSystems,
  laneOf,
  looksLikeNotFound,
  pickOpenableApps,
  signInNavigationReason,
  type CredentialEvidence,
} from "./journey-checks";

const APP = "https://beta.slides.agent-native.com";

test("a navigation to a sign-in route is a signed-in user being pushed out", () => {
  for (const url of [
    `${APP}/sign-in?c=abc`,
    `${APP}/_agent-native/sign-in`,
    `${APP}/dispatch/login`,
    `${APP}/signup`,
  ]) {
    assert.equal(signInNavigationReason(url, [APP]), "a sign-in route", url);
  }
});

test("Google OAuth and foreign origins are reported, in-app routes are not", () => {
  assert.equal(
    signInNavigationReason("https://accounts.google.com/o/oauth2/auth", [APP]),
    "Google OAuth",
  );
  assert.match(
    signInNavigationReason("https://example.com/home", [APP]) ?? "",
    /outside the app under test/,
  );
  assert.equal(signInNavigationReason(`${APP}/home`, [APP]), null);
  assert.equal(signInNavigationReason(`${APP}/settings/profile`, [APP]), null);
  assert.equal(signInNavigationReason("about:blank", [APP]), null);
});

test("an app route that merely contains the word login is not a sign-in route", () => {
  assert.equal(signInNavigationReason(`${APP}/deck/loginflow`, [APP]), null);
  assert.equal(
    signInNavigationReason(`${APP}/design/signing-off`, [APP]),
    null,
  );
});

test("lists every navigation with its step so a loop is visible", () => {
  assert.equal(describeNavigations([]), "(none recorded)");
  assert.equal(
    describeNavigations([
      { step: "reload 1/5", url: `${APP}/home` },
      { step: "reload 2/5", url: `${APP}/sign-in` },
    ]),
    `1. [reload 1/5] ${APP}/home\n2. [reload 2/5] ${APP}/sign-in`,
  );
});

test("finds the false-credits and connect-blocker copy line by line", () => {
  const blocking = findBlockingText(
    [
      "Slides",
      "Your Builder credits are used up · Daily default limit",
      "Upgrade plan",
      "Connect AI above to continue...",
      "Connect Builder.io",
    ].join("\n"),
  );
  assert.equal(blocking.credits.length, 2);
  assert.deepEqual(blocking.connect, ["Connect AI above to continue..."]);
  assert.deepEqual(findBlockingText("Decks\nNew deck"), {
    credits: [],
    connect: [],
  });
});

const healthy: CredentialEvidence = {
  app: "slides",
  composer: "usable",
  visibleText: "Decks\nNew deck",
  engineConfigured: true,
  creditExhausted: false,
  composerRequired: true,
};

test("a coherent healthy state has no problems", () => {
  assert.deepEqual(diagnoseCredentialState(healthy), []);
});

test("a credits notice that the credit API contradicts is the false-credits state", () => {
  const problems = diagnoseCredentialState({
    ...healthy,
    visibleText: "Your Builder credits are used up",
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /false-credits state/);
});

test("a credits notice that is true only matters when the composer is blocked", () => {
  assert.deepEqual(
    diagnoseCredentialState({
      ...healthy,
      creditExhausted: true,
      visibleText: "Your Builder credits are used up",
    }),
    [],
  );
  const blocked = diagnoseCredentialState({
    ...healthy,
    composer: "disabled",
    engineConfigured: false,
    composerRequired: false,
    creditExhausted: true,
    visibleText: "Your Builder credits are used up",
  });
  assert.equal(blocked.length, 1);
  assert.match(blocked[0], /really are exhausted/);
});

test("a configured engine next to a disabled composer or a connect blocker contradicts itself", () => {
  const disabled = diagnoseCredentialState({
    ...healthy,
    composer: "disabled",
  });
  assert.match(disabled.join("\n"), /composer is disabled/);

  const banner = diagnoseCredentialState({
    ...healthy,
    visibleText: "Connect AI above to continue...",
  });
  assert.equal(banner.length, 2);
});

test("a disabled composer with no provider is a coherent state, not a failure", () => {
  assert.deepEqual(
    diagnoseCredentialState({
      ...healthy,
      composer: "disabled",
      engineConfigured: false,
      composerRequired: false,
      visibleText: "Connect AI above to continue...",
    }),
    [],
  );
});

test("a required composer that never rendered is reported", () => {
  const problems = diagnoseCredentialState({
    ...healthy,
    composer: "absent",
  });
  assert.match(problems.join("\n"), /no agent composer rendered/);
});

test("an app that should have an AI provider but reports none is reported", () => {
  const problems = diagnoseCredentialState({
    ...healthy,
    composer: "disabled",
    engineConfigured: false,
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no AI provider for the e2e account/);
});

test("the Builder page and the server agree when both say connected", () => {
  assert.deepEqual(
    builderConnectionDisagreements({
      configured: true,
      effective: "org",
      settingsText: "Builder.io\nConnected\nDisconnect",
      chromeText: "Decks",
      creditExhausted: false,
    }),
    [],
  );
});

test("a configured connection with no connected state on the page disagrees", () => {
  const out = builderConnectionDisagreements({
    configured: true,
    effective: "org",
    settingsText: "Builder.io\nConnect Builder.io",
    chromeText: "Decks",
    creditExhausted: false,
  });
  assert.equal(out.length, 1);
  assert.match(out[0], /shows no Connected/);
});

test("a connection that needs reconnecting still counts as a connected state", () => {
  assert.deepEqual(
    builderConnectionDisagreements({
      configured: true,
      effective: "org",
      settingsText: "Organization\nNeeds to be reconnected.\nManage",
      chromeText: "Decks",
      creditExhausted: false,
    }),
    [],
  );
});

test("Disconnect with no connection, and a credits notice with no connection, disagree", () => {
  const out = builderConnectionDisagreements({
    configured: false,
    effective: null,
    settingsText: "Builder.io\nDisconnect",
    chromeText: "Your Builder credits are used up",
    creditExhausted: null,
  });
  assert.equal(out.length, 2);
});

test("a not-connected page is not mistaken for a connected one", () => {
  assert.deepEqual(
    builderConnectionDisagreements({
      configured: false,
      effective: null,
      settingsText: "Builder.io\nNot connected\nConnect Builder.io",
      chromeText: "Decks",
      creditExhausted: null,
    }),
    [],
  );
});

const NOW = Date.parse("2026-10-01T12:00:00Z");
const HOUR = 3_600_000;

function builderRow(
  id: string,
  createdHoursAgo: number,
  data: Record<string, unknown> = {},
) {
  return {
    id,
    title: `System ${id}`,
    ownerEmail: "someone@example.com",
    createdAt: new Date(NOW - createdHoursAgo * HOUR).toISOString(),
    updatedAt: new Date(NOW - createdHoursAgo * HOUR).toISOString(),
    data: JSON.stringify({ source: "builder", ...data }),
  };
}

test("reports a Builder system that has been unindexed past the bound", () => {
  const report = findStuckDesignSystems(
    [
      builderRow("old", 30, { builderStatus: "in-progress" }),
      builderRow("fresh", 0.2, { builderStatus: "in-progress" }),
      builderRow("done", 50, { docCount: 12, builderStatus: "ready" }),
      { id: "manual", data: JSON.stringify({ source: "manual" }) },
    ],
    NOW,
    24 * HOUR,
  );
  assert.equal(report.total, 4);
  assert.equal(report.builderBacked, 3);
  assert.equal(report.indexed, 1);
  assert.deepEqual(
    report.stuck.map((entry) => [
      entry.id,
      entry.ageHours,
      entry.builderStatus,
    ]),
    [["old", 30, "in-progress"]],
  );
  assert.deepEqual(report.unreadable, []);
});

test("takes the document count from the row when the data omits it", () => {
  const report = findStuckDesignSystems(
    [{ ...builderRow("counted", 40), docCount: 3 }],
    NOW,
    24 * HOUR,
  );
  assert.equal(report.indexed, 1);
  assert.equal(report.stuck.length, 0);
});

test("unreadable rows are reported, never treated as healthy", () => {
  const report = findStuckDesignSystems(
    [
      { id: "garbled", data: "{not json" },
      { id: "no-data" },
      { ...builderRow("no-time", 1), createdAt: "yesterday-ish" },
    ],
    NOW,
    24 * HOUR,
  );
  assert.deepEqual(
    report.unreadable.map((entry) => entry.id),
    ["garbled", "no-data", "no-time"],
  );
});

test("accepts epoch-millisecond timestamps", () => {
  const report = findStuckDesignSystems(
    [{ ...builderRow("epoch", 0), createdAt: NOW - 48 * HOUR }],
    NOW,
    24 * HOUR,
  );
  assert.equal(report.stuck[0]?.ageHours, 48);
});

test("classifies hosts into lanes and detects a crossing", () => {
  assert.equal(laneOf("beta.slides.agent-native.com"), "beta");
  assert.equal(laneOf("slides.agent-native.com"), "production");
  assert.equal(laneOf("custom-app.example.com"), "other");
  assert.equal(
    crossedLanes("slides.agent-native.com", "beta.slides.agent-native.com"),
    true,
  );
  assert.equal(
    crossedLanes(
      "beta.slides.agent-native.com",
      "beta.design.agent-native.com",
    ),
    false,
  );
  assert.equal(
    crossedLanes("slides.agent-native.com", "custom-app.example.com"),
    false,
  );
});

test("picks ready visible apps, skips Dispatch, archived, pending, duplicates", () => {
  const picked = pickOpenableApps(
    [
      { id: "dispatch", name: "Dispatch", isDispatch: true },
      { id: "cs-health", name: "CS health", status: "ready" },
      { id: "cs-health", name: "dup" },
      { id: "old", name: "Old", archived: true },
      { id: "building", name: "Building", status: "pending" },
      { id: "two", name: "" },
      { name: "no id" },
      { id: "three", name: "Three" },
    ],
    2,
  );
  assert.deepEqual(picked, [
    { id: "cs-health", name: "CS health" },
    { id: "two", name: "two" },
  ]);
});

test("recognises a not-found screen only near the top of the page", () => {
  assert.equal(looksLikeNotFound("404\nPage not found"), true);
  assert.equal(looksLikeNotFound("App not found"), true);
  assert.equal(
    looksLikeNotFound("Dashboard\n" + "x".repeat(500) + "404"),
    false,
  );
});
