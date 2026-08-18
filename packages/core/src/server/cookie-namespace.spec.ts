import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../app-config/index.js";
import { resolveAuthCookieNamespace } from "./cookie-namespace.js";

const originalEnv = { ...process.env };

const WORKSPACE_ENV_KEYS = [
  "AGENT_NATIVE_WORKSPACE",
  "VITE_AGENT_NATIVE_WORKSPACE",
  "AGENT_NATIVE_WORKSPACE_APPS_JSON",
  "VITE_AGENT_NATIVE_WORKSPACE_APPS_JSON",
];

describe("resolveAuthCookieNamespace", () => {
  beforeEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
    for (const key of WORKSPACE_ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
  });

  it("isolates standalone local dev cookies with npm_package_name", () => {
    expect(
      resolveAuthCookieNamespace({
        NODE_ENV: "development",
        npm_package_name: "calendar",
      }),
    ).toMatchObject({
      frameworkCookieName: "an_session_calendar",
      betterAuthCookiePrefix: "an_calendar",
      betterAuthCookieDomain: undefined,
    });
  });

  it("falls back to package.json name for standalone local dev", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "an-cookie-test-"));
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "@acme/mail-app" }),
    );

    expect(
      resolveAuthCookieNamespace({ NODE_ENV: "development" }, dir),
    ).toMatchObject({
      frameworkCookieName: "an_session_acme_mail_app",
      betterAuthCookiePrefix: "an_acme_mail_app",
    });
  });

  it("keeps Better Auth's production standalone prefix stable", () => {
    expect(
      resolveAuthCookieNamespace({
        NODE_ENV: "production",
        APP_NAME: "mail",
      }),
    ).toMatchObject({
      frameworkCookieName: "an_session_mail",
      betterAuthCookiePrefix: "an",
      betterAuthCookieDomain: undefined,
    });
  });

  it("keeps workspace mode in one shared auth realm", () => {
    expect(
      resolveAuthCookieNamespace({
        NODE_ENV: "production",
        APP_NAME: "mail",
        AGENT_NATIVE_WORKSPACE: "1",
      }),
    ).toMatchObject({
      frameworkCookieName: "an_session_workspace",
      betterAuthCookiePrefix: "an",
      betterAuthCookieDomain: undefined,
    });
  });

  it("keeps boolean-style workspace mode in the shared auth realm", () => {
    expect(
      resolveAuthCookieNamespace({
        NODE_ENV: "production",
        APP_NAME: "mail",
        AGENT_NATIVE_WORKSPACE: "true",
      }),
    ).toMatchObject({
      frameworkCookieName: "an_session_workspace",
      betterAuthCookiePrefix: "an",
      betterAuthCookieDomain: undefined,
    });
  });

  it("uses app-config-only workspace mode for the production namespace", () => {
    defineAppConfig({ workspace: { isWorkspace: true } });

    expect(
      resolveAuthCookieNamespace({
        NODE_ENV: "production",
        APP_NAME: "mail",
      }),
    ).toMatchObject({
      frameworkCookieName: "an_session_mail",
    });

    expect(resolveAuthCookieNamespace()).toMatchObject({
      frameworkCookieName: "an_session_workspace",
      isWorkspaceMode: true,
    });
  });

  it("uses the canonical workspace alias before the VITE mirror", () => {
    expect(
      resolveAuthCookieNamespace({
        NODE_ENV: "production",
        APP_NAME: "mail",
        AGENT_NATIVE_WORKSPACE: "0",
        VITE_AGENT_NATIVE_WORKSPACE: "true",
      }),
    ).toMatchObject({
      frameworkCookieName: "an_session_mail",
      isWorkspaceMode: false,
    });
  });

  it("preserves explicit shared cookie domains for custom same-DB deploys", () => {
    expect(
      resolveAuthCookieNamespace({
        NODE_ENV: "production",
        APP_NAME: "mail",
        COOKIE_DOMAIN: ".example.com",
      }),
    ).toMatchObject({
      frameworkCookieName: "an_session",
      frameworkCookieDomain: ".example.com",
      betterAuthCookiePrefix: "an",
      betterAuthCookieDomain: ".example.com",
    });
  });

  it("isolates first-party agent-native.com apps even when COOKIE_DOMAIN is configured", () => {
    const namespace = resolveAuthCookieNamespace({
      NODE_ENV: "production",
      APP_NAME: "mail",
      COOKIE_DOMAIN: ".agent-native.com",
    });

    expect(namespace).toMatchObject({
      frameworkCookieName: "an_session_mail",
      frameworkCookieDomain: undefined,
      betterAuthCookiePrefix: "an_mail",
      betterAuthCookieDomain: undefined,
    });
    expect(namespace.frameworkCookieNamesToClear).toContain("an_session");
    expect(namespace.frameworkCookieDomainsToClear).toContain(
      ".agent-native.com",
    );
  });

  it("can derive the first-party slug from APP_URL when APP_NAME is missing", () => {
    expect(
      resolveAuthCookieNamespace({
        NODE_ENV: "production",
        COOKIE_DOMAIN: ".agent-native.com",
        APP_URL: "https://slides.agent-native.com",
      }),
    ).toMatchObject({
      frameworkCookieName: "an_session_slides",
      betterAuthCookiePrefix: "an_slides",
    });
  });

  it.each(["BETTER_AUTH_URL", "VITE_BETTER_AUTH_URL"])(
    "can derive the first-party slug from %s when APP_NAME is missing",
    (key) => {
      expect(
        resolveAuthCookieNamespace({
          NODE_ENV: "production",
          COOKIE_DOMAIN: ".agent-native.com",
          [key]: "https://mail.agent-native.com",
        }),
      ).toMatchObject({
        frameworkCookieName: "an_session_mail",
        betterAuthCookiePrefix: "an_mail",
      });
    },
  );

  it("fails closed when a first-party isolated app has no identifier", () => {
    expect(() =>
      resolveAuthCookieNamespace({
        NODE_ENV: "production",
        COOKIE_DOMAIN: ".agent-native.com",
      }),
    ).toThrow(/requires an app identifier/);
  });

  it("allows first-party shared cookies only with an explicit opt-in", () => {
    expect(
      resolveAuthCookieNamespace({
        NODE_ENV: "production",
        COOKIE_DOMAIN: ".agent-native.com",
        AGENT_NATIVE_SHARE_COOKIE_DOMAIN: "1",
      }),
    ).toMatchObject({
      frameworkCookieName: "an_session",
      frameworkCookieDomain: ".agent-native.com",
      betterAuthCookiePrefix: "an",
      betterAuthCookieDomain: ".agent-native.com",
    });
  });
});
