import { afterEach, describe, expect, it } from "vitest";

import {
  configureAgentNativeEmbeddedEnvironment,
  createAgentNativeEmbeddedAuthOptions,
  normalizeAgentNativeEmbeddedSession,
} from "./embedded.js";

const ORIGINAL_ENV = {
  APP_NAME: process.env.APP_NAME,
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_AUTH_TOKEN: process.env.DATABASE_AUTH_TOKEN,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("embedded Agent-Native helpers", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("normalizes host-auth sessions into framework auth sessions", () => {
    expect(
      normalizeAgentNativeEmbeddedSession({
        email: "ada@example.com",
        userId: "user-1",
        name: "Ada",
        organizationId: "org-1",
        role: "admin",
      }),
    ).toEqual({
      email: "ada@example.com",
      userId: "user-1",
      token: undefined,
      name: "Ada",
      orgId: "org-1",
      orgRole: "admin",
    });
  });

  it("uses userId as the owner key when the host has no email", () => {
    expect(
      normalizeAgentNativeEmbeddedSession({
        email: "",
        userId: "builder-user-1",
        orgId: "org-1",
      }),
    ).toMatchObject({
      email: "builder-user-1",
      userId: "builder-user-1",
      orgId: "org-1",
    });
  });

  it("builds host-auth options that disable standalone Google OAuth", async () => {
    const auth = createAgentNativeEmbeddedAuthOptions(async () => ({
      email: "grace@example.com",
      organizationId: "org-2",
    }));

    await expect(auth?.getSession?.({} as never)).resolves.toMatchObject({
      email: "grace@example.com",
      orgId: "org-2",
    });
    expect(auth?.mountGoogleOAuthRoutes).toBe(false);
  });

  it("applies explicit embedded database environment", () => {
    configureAgentNativeEmbeddedEnvironment({
      appName: "builder",
      databaseUrl: "postgres://example/db",
      databaseAuthToken: "secret",
    });

    expect(process.env.APP_NAME).toBe("builder");
    expect(process.env.DATABASE_URL).toBe("postgres://example/db");
    expect(process.env.DATABASE_AUTH_TOKEN).toBe("secret");
  });
});
