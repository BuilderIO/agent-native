import { describe, expect, it } from "vitest";

import { resolveNitroBuildReplacements } from "./build.js";

/**
 * Appearance > Theme family > Agent-Native answered
 * "This theme family is not enabled for the current app." on the served app,
 * even though the app config lists both families.
 *
 * The action that saves the choice runs on the server and validates against the
 * app config it can see there. The client bundle receives that config as a build
 * define from the Vite config; the server bundle received nothing, so the allow
 * list fell back to the default family alone. The server build now embeds the
 * same resolved config, and these cases pin that the replacement is there, is the
 * app's real config, and is inserted as an expression so the reader's
 * `typeof … === "undefined"` guard still resolves to the value.
 */
describe("server bundle carries the app config", () => {
  const appConfig = {
    themeFamily: {
      families: ["original", "agent-native"],
      defaultFamily: "original",
    },
  };

  it("embeds the resolved app config for the server bundle", () => {
    const replacement = resolveNitroBuildReplacements(
      {},
      undefined,
      undefined,
      "",
      "",
      "",
      appConfig,
    ).__AGENT_NATIVE_APP_CONFIG__;

    expect(typeof replacement).toBe("string");
    // Substituted as raw source, so it has to be a self-contained expression.
    expect(replacement.startsWith("{")).toBe(true);
    expect(JSON.parse(replacement)).toEqual(appConfig);
  });

  it("falls back to an empty config, which the reader turns into {}", () => {
    const replacement = resolveNitroBuildReplacements(
      {},
    ).__AGENT_NATIVE_APP_CONFIG__;

    expect(JSON.parse(replacement)).toEqual({});
  });

  it("does not disturb the settings the server already received", () => {
    const replacements = resolveNitroBuildReplacements(
      {},
      undefined,
      undefined,
      "connect",
      "true",
      "",
      appConfig,
    );

    expect(
      replacements["process.env.AGENT_NATIVE_BUILD_FIRST_RUN_ONBOARDING"],
    ).toBe(JSON.stringify("connect"));
    expect(replacements["process.env.AGENT_NATIVE_BUILD_HARNESS"]).toBe(
      JSON.stringify("true"),
    );
  });
});
