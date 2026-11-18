import assert from "node:assert/strict";
import test from "node:test";

import { selectedSignupTargets } from "./targets";

const ACTIVE_EMAIL_SIGNUP_APPS = [
  "analytics",
  "assets",
  "brain",
  "clips",
  "content",
  "crm",
  "design",
  "dispatch",
  "forms",
  "plan",
  "slides",
];

function withSignupEnv<T>(
  apps: string | undefined,
  environments: string | undefined,
  run: () => T,
): T {
  const previousApps = process.env.SIGNUP_E2E_APPS;
  const previousEnvironments = process.env.SIGNUP_E2E_ENVIRONMENTS;
  if (apps === undefined) delete process.env.SIGNUP_E2E_APPS;
  else process.env.SIGNUP_E2E_APPS = apps;
  if (environments === undefined) delete process.env.SIGNUP_E2E_ENVIRONMENTS;
  else process.env.SIGNUP_E2E_ENVIRONMENTS = environments;
  try {
    return run();
  } finally {
    if (previousApps === undefined) delete process.env.SIGNUP_E2E_APPS;
    else process.env.SIGNUP_E2E_APPS = previousApps;
    if (previousEnvironments === undefined)
      delete process.env.SIGNUP_E2E_ENVIRONMENTS;
    else process.env.SIGNUP_E2E_ENVIRONMENTS = previousEnvironments;
  }
}

void test("default targets are the active email signup apps on beta", () => {
  const targets = withSignupEnv(undefined, undefined, selectedSignupTargets);
  assert.deepEqual(
    targets.map((target) => target.app).sort(),
    ACTIVE_EMAIL_SIGNUP_APPS,
  );
  assert.deepEqual(
    [...new Set(targets.map((target) => target.environment))],
    ["beta"],
  );
});

void test("all on production never reaches the deprecated starter host", () => {
  const targets = withSignupEnv("all", "production", selectedSignupTargets);
  assert.deepEqual(
    targets.map((target) => target.app).sort(),
    ACTIVE_EMAIL_SIGNUP_APPS,
  );
  assert.equal(
    targets.some((target) =>
      new URL(target.origin).hostname.startsWith("chat."),
    ),
    false,
  );
  assert.equal(
    targets.find((target) => target.app === "forms")?.origin,
    "https://forms.agent-native.com",
  );
});

for (const app of ["chat", "factory", "mail", "calendar"]) {
  void test(`explicit ${app} target is rejected`, () => {
    assert.throws(
      () => withSignupEnv(app, "production", selectedSignupTargets),
      /without email signup/,
    );
  });
}

for (const apps of ["all,chat", "chat,all", "forms,all"]) {
  void test(`${apps} is rejected instead of dropping an app`, () => {
    assert.throws(
      () => withSignupEnv(apps, "production", selectedSignupTargets),
      /use all alone/,
    );
  });
}
