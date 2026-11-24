import { H3 } from "h3";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";
import { closeDbExec } from "../db/client.js";
import { withMigrationRuntime } from "../db/migration-runtime.js";
import { betterAuthStore } from "./better-auth-migrations.js";
import { getH3App } from "./framework-request-handler.js";

vi.mock("../deploy/route-discovery.js", () => ({
  getMissingDefaultPlugins: vi.fn(async () => []),
}));

import { autoMountAuth } from "./auth.js";

const SECRET = "example-auth-secret-for-integration-tests-only";
let previousDatabaseUrl: string | undefined;

async function post(app: H3, path: string, body: unknown) {
  const res = await app.request(
    new Request(`http://localhost/_agent-native/auth/ba${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
      },
      body: JSON.stringify(body),
    }),
  );
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

describe("email+password auth over a real server", () => {
  beforeAll(async () => {
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "pglite:memory";
    await closeDbExec();
  });
  afterAll(async () => {
    await closeDbExec();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetAppConfigForTests();
  });

  async function mountApp() {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("BETTER_AUTH_SECRET", SECRET);
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost");
    vi.stubEnv("AUTH_DISABLED", "");
    vi.stubEnv("ACCESS_TOKEN", "");
    vi.stubEnv("ACCESS_TOKENS", "");
    resetAppConfigForTests();
    const app = new H3();
    await autoMountAuth(getH3App({ h3: app }), {});
    return app;
  }

  it("answers a typed 503 instead of a bare 500 when auth tables are not migrated", async () => {
    const app = await mountApp();
    const res = await post(app, "/sign-up/email", {
      email: "new-user@example.com",
      password: "correct-horse-battery",
      name: "New User",
    });
    expect(res.status).toBe(503);
    expect(res.json).toMatchObject({ code: "AUTH_SCHEMA_NOT_MIGRATED" });

    const signIn = await post(app, "/sign-in/email", {
      email: "new-user@example.com",
      password: "correct-horse-battery",
    });
    expect(signIn.status).toBe(503);
    expect(signIn.json).toMatchObject({ code: "AUTH_SCHEMA_NOT_MIGRATED" });
  }, 60_000);

  it("signs up, signs in, and rejects an invalid address with a 4xx", async () => {
    await withMigrationRuntime(() => betterAuthStore.ready());
    const app = await mountApp();

    const bad = await post(app, "/sign-up/email", {
      email: "not-an-email",
      password: "correct-horse-battery",
      name: "x",
    });
    expect(bad.status).toBe(400);

    const up = await post(app, "/sign-up/email", {
      email: "new-user@example.com",
      password: "correct-horse-battery",
      name: "New User",
    });
    expect(up.json).toMatchObject({ user: { email: "new-user@example.com" } });
    expect(up.status).toBe(200);

    const inn = await post(app, "/sign-in/email", {
      email: "new-user@example.com",
      password: "correct-horse-battery",
    });
    expect(inn.status).toBe(200);
  }, 60_000);
});
