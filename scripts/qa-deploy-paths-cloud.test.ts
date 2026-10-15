import assert from "node:assert/strict";
import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  baseEnv,
  fetchWithTimeout,
  NETLIFY_CLI_PACKAGE,
  netlifyCliArgs,
  netlifyEnv,
  VERCEL_CLI_PACKAGE,
  vercelCliArgs,
  vercelEnv,
} from "./qa-deploy-paths-cloud";

// What a developer's shell or a CI job can hold that a child process must not
// see: the check's own credentials, other credentials, anything that redirects
// the app's database, and things that change how sign-up or the runtime behave.
const AMBIENT: Record<string, string> = {
  NETLIFY_AUTH_TOKEN: "fake-netlify-token-for-tests",
  VERCEL_TOKEN: "fake-vercel-token-for-tests",
  VERCEL_ORG_ID: "someone-elses-team",
  NETLIFY_SITE_ID: "someone-elses-site",
  NETLIFY_DATABASE_URL: "postgres://host/netlify-db",
  NETLIFY_DATABASE_URL_UNPOOLED: "postgres://host/netlify-unpooled",
  DEPLOY_CHECK_DATABASE_URL: "postgres://host/admin",
  DATABASE_URL: "postgres://host/app",
  DATABASE_URL_UNPOOLED: "postgres://host/unpooled",
  MY_APP_DATABASE_URL: "postgres://host/app-prefixed",
  BETTER_AUTH_SECRET: "fake-auth-secret-for-tests",
  GITHUB_TOKEN: "fake-github-token-for-tests",
  GH_TOKEN: "fake-gh-token-for-tests",
  OPENAI_API_KEY: "fake-provider-key-for-tests",
  RESEND_API_KEY: "fake-email-key-for-tests",
  AWS_SECRET_ACCESS_KEY: "fake-aws-key-for-tests",
  SSH_AUTH_SOCK: "/tmp/agent.sock",
  NODE_OPTIONS: "--require /tmp/hook.js",
  NODE_ENV: "development",
  NITRO_PRESET: "vercel",
  AUTH_DISABLED: "true",
  npm_config_user_agent: "pnpm/10",
  PNPM_HOME: "/somewhere",
  SOMETHING_UNRELATED: "x",
};

// What a toolchain, a proxy and the Docker CLI need.
const NEEDED: Record<string, string> = {
  PATH: "/usr/bin:/bin",
  HOME: "/home/someone",
  CI: "true",
  LC_ALL: "C.UTF-8",
  XDG_CONFIG_HOME: "/home/someone/.config",
  HTTPS_PROXY: "http://proxy.example:3128",
  NODE_EXTRA_CA_CERTS: "/etc/ssl/corp.pem",
  DOCKER_HOST: "unix:///var/run/docker.sock",
  VOLTA_HOME: "/home/someone/.volta",
  COREPACK_HOME: "/home/someone/.corepack",
};

const touched = [...Object.keys(AMBIENT), ...Object.keys(NEEDED)];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(touched.map((key) => [key, process.env[key]]));
  Object.assign(process.env, AMBIENT, NEEDED);
});

afterEach(() => {
  for (const key of touched) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("the environment of a child process the check starts", () => {
  it("holds nothing from the caller's environment that is not on the allowlist", () => {
    const env = baseEnv();
    for (const key of Object.keys(AMBIENT)) {
      assert.equal(env[key], undefined, `${key} reached a child process`);
    }
  });

  it("holds none of the check's credentials, so install, build and the app under test cannot read them", () => {
    const env = baseEnv();
    assert.equal(env.NETLIFY_AUTH_TOKEN, undefined);
    assert.equal(env.VERCEL_TOKEN, undefined);
    assert.equal(env.DEPLOY_CHECK_DATABASE_URL, undefined);
  });

  it("cannot be pointed at another database by any name the app reads", () => {
    const env = baseEnv();
    const redirects = Object.keys(env).filter((key) =>
      /DATABASE_URL/i.test(key),
    );
    assert.deepEqual(redirects, []);
  });

  it("keeps what a toolchain, a proxy and the Docker CLI need to run", () => {
    const env = baseEnv();
    for (const [key, value] of Object.entries(NEEDED)) {
      assert.equal(env[key], value, `${key} was dropped`);
    }
  });
});

describe("the environment of a Netlify CLI call", () => {
  it("is the only one that carries the Netlify token", () => {
    const env = netlifyEnv();
    assert.equal(env.NETLIFY_AUTH_TOKEN, "fake-netlify-token-for-tests");
    assert.equal(env.VERCEL_TOKEN, undefined);
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

describe("the environment of a Vercel CLI call", () => {
  it("is the only one that carries the Vercel token, and not the Netlify one", () => {
    const env = vercelEnv();
    assert.equal(env.VERCEL_TOKEN, "fake-vercel-token-for-tests");
    assert.equal(env.NETLIFY_AUTH_TOKEN, undefined);
    assert.equal(env.DEPLOY_CHECK_DATABASE_URL, undefined);
    assert.equal(env.VERCEL_ORG_ID, undefined);
  });

  it("keeps install scripts of the CLI's own dependencies off", () => {
    assert.equal(vercelEnv().npm_config_ignore_scripts, "true");
  });

  it("sets no token when there is none, so the CLI uses the user's own login", () => {
    delete process.env.VERCEL_TOKEN;
    assert.equal("VERCEL_TOKEN" in vercelEnv(), false);
  });
});

describe("the Vercel CLI the check runs", () => {
  it("is pinned to an exact version, not a range or a tag", () => {
    assert.match(VERCEL_CLI_PACKAGE, /^vercel@\d+\.\d+\.\d+$/);
  });

  it("runs the pinned package's `vercel` binary with the given arguments", () => {
    assert.deepEqual(vercelCliArgs(["env", "rm", "A", "production"]), [
      "--yes",
      "--package",
      VERCEL_CLI_PACKAGE,
      "vercel",
      "env",
      "rm",
      "A",
      "production",
    ]);
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

describe("a request to the app under test", () => {
  let server: Server | undefined;

  afterEach(async () => {
    server?.closeAllConnections();
    await new Promise((resolve) => server?.close(resolve));
    server = undefined;
  });

  async function listen(handler: RequestListener) {
    server = createServer(handler);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  it("gives up on a server that accepts the connection and never answers", async () => {
    const url = await listen(() => {});
    const started = Date.now();
    await assert.rejects(fetchWithTimeout(url, {}, 300), (error: Error) => {
      assert.equal(error.name, "TimeoutError");
      return true;
    });
    assert.ok(
      Date.now() - started < 5_000,
      "the timeout did not bound the wait",
    );
  });

  it("gives up on a server that sends headers and then stalls the body", async () => {
    const url = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.write("partial");
    });
    await assert.rejects(
      (async () => (await fetchWithTimeout(url, {}, 300)).text())(),
      (error: Error) => error.name === "TimeoutError",
    );
  });

  it("returns a normal response untouched", async () => {
    const url = await listen((_request, response) => {
      response.writeHead(200);
      response.end("pong");
    });
    const response = await fetchWithTimeout(url);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "pong");
  });
});
