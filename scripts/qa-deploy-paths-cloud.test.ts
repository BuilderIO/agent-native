import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  baseEnv,
  NETLIFY_CLI_PACKAGE,
  netlifyCliArgs,
  netlifyEnv,
} from "./qa-deploy-paths-cloud";

const TOUCHED = [
  "NETLIFY_AUTH_TOKEN",
  "NETLIFY_SITE_ID",
  "NETLIFY_DATABASE_URL",
  "DEPLOY_CHECK_DATABASE_URL",
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "npm_config_user_agent",
  "PNPM_HOME",
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(TOUCHED.map((key) => [key, process.env[key]]));
  process.env.NETLIFY_AUTH_TOKEN = "fake-netlify-token-for-tests";
  process.env.NETLIFY_SITE_ID = "someone-elses-site";
  process.env.NETLIFY_DATABASE_URL = "postgres://host/netlify-db";
  process.env.DEPLOY_CHECK_DATABASE_URL = "postgres://host/admin";
  process.env.DATABASE_URL = "postgres://host/app";
  process.env.BETTER_AUTH_SECRET = "fake-auth-secret-for-tests";
  process.env.npm_config_user_agent = "pnpm/10";
  process.env.PNPM_HOME = "/somewhere";
});

afterEach(() => {
  for (const key of TOUCHED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("the environment of a child process the check starts", () => {
  it("holds none of the check's credentials, so install, build and the app under test cannot read them", () => {
    const env = baseEnv();
    assert.equal(env.NETLIFY_AUTH_TOKEN, undefined);
    assert.equal(env.DEPLOY_CHECK_DATABASE_URL, undefined);
  });

  it("holds none of the settings the check sets itself", () => {
    const env = baseEnv();
    for (const key of [
      "NETLIFY_SITE_ID",
      "NETLIFY_DATABASE_URL",
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "npm_config_user_agent",
      "PNPM_HOME",
    ]) {
      assert.equal(env[key], undefined, `${key} leaked into a child process`);
    }
  });

  it("still carries what a command needs to run", () => {
    assert.equal(baseEnv().PATH, process.env.PATH);
  });
});

describe("the environment of a Netlify CLI call", () => {
  it("is the only one that carries the Netlify token", () => {
    const env = netlifyEnv();
    assert.equal(env.NETLIFY_AUTH_TOKEN, "fake-netlify-token-for-tests");
    assert.equal(env.DEPLOY_CHECK_DATABASE_URL, undefined);
    assert.equal(env.NETLIFY_SITE_ID, undefined);
  });

  it("keeps install scripts of the CLI's own dependencies off", () => {
    assert.equal(netlifyEnv().npm_config_ignore_scripts, "true");
  });

  it("sets no token when there is none, so the CLI uses the user's own login", () => {
    delete process.env.NETLIFY_AUTH_TOKEN;
    assert.equal("NETLIFY_AUTH_TOKEN" in netlifyEnv(), false);
  });
});

describe("the Netlify CLI the check runs", () => {
  it("is pinned to an exact version, not a range or a tag", () => {
    assert.match(NETLIFY_CLI_PACKAGE, /^netlify-cli@\d+\.\d+\.\d+$/);
  });

  it("runs the pinned package's `netlify` binary with the given arguments", () => {
    assert.deepEqual(netlifyCliArgs(["env:set", "A", "b"]), [
      "--yes",
      "--package",
      NETLIFY_CLI_PACKAGE,
      "netlify",
      "env:set",
      "A",
      "b",
    ]);
  });
});
