import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  getOnboardingHtml,
  getResetPasswordHtml,
} from "@agent-native/core/server/onboarding-html";
import { describe, expect, it } from "vitest";

import { renderAuthPage, renderAuthResetPasswordPage } from "./server.js";

const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const templatesRoot = join(repoRoot, "templates");
const templateAuthPlugins = readdirSync(templatesRoot, {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(templatesRoot, entry.name, "server/plugins/auth.ts"))
  .filter((path) => {
    try {
      readFileSync(path);
      return true;
    } catch {
      return false;
    }
  });
const firstPartyAuthPlugins = [
  ...templateAuthPlugins,
  join(repoRoot, "packages/docs/server/plugins/auth.ts"),
  join(repoRoot, "packages/dispatch/src/server/plugins/auth.ts"),
  join(repoRoot, "packages/core/src/templates/default/server/plugins/auth.ts"),
];

describe("Toolkit auth server renderer", () => {
  it("renders the full sign-in page and shared wave into the initial HTML", () => {
    const html = getOnboardingHtml({
      requestHost: "slides.agent-native.com",
      renderSignInPage: renderAuthPage,
    });

    expect(html).toContain('data-agent-native-wave="true"');
    expect(html).toContain('id="signup-form"');
    expect(html).toContain('id="login-form"');
    expect(html).not.toContain('data-agent-native-auth-fallback="true"');
  });

  it("renders the reset password page before hydration", () => {
    const html = getResetPasswordHtml(
      "/_agent-native/auth/reset",
      renderAuthResetPasswordPage,
    );

    expect(html).toContain('id="reset-form"');
    expect(html).not.toContain('data-agent-native-auth-fallback="true"');
  });

  it("routes every first-party auth plugin through the shared SSR renderer", () => {
    for (const path of firstPartyAuthPlugins) {
      const source = readFileSync(path, "utf8");
      if (source.includes("@agent-native/dispatch/server")) continue;
      expect(source, path).toContain("createToolkitAuthPlugin");
      expect(source, path).not.toContain(
        'createAuthPlugin } from "@agent-native/core/server"',
      );
    }
  });
});
