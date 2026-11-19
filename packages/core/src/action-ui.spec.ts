import { describe, expect, it } from "vitest";

import {
  appLocalMarkdownLinkPath,
  normalizeActionChatUIConfig,
} from "./action-ui.js";

describe("appLocalMarkdownLinkPath", () => {
  it.each([
    ["/#agent-native-app-local", "/"],
    [
      "/settings/automations?automationId=a%26b#agent-native-app-local",
      "/settings/automations?automationId=a%26b",
    ],
  ])("returns the local path for %s", (href, path) => {
    expect(appLocalMarkdownLinkPath(href)).toBe(path);
  });

  it.each([
    "settings#agent-native-app-local",
    "https://example.test/settings#agent-native-app-local",
    "//example.test/settings#agent-native-app-local",
    "/\\example.test/settings#agent-native-app-local",
    "/settings\\other#agent-native-app-local",
    "/settings",
    "/settings#agent-native-app-local-extra",
    "",
  ])("rejects a non-local or unmarked link %s", (href) => {
    expect(appLocalMarkdownLinkPath(href)).toBeNull();
  });
});

describe("normalizeActionChatUIConfig", () => {
  it("preserves the server-side applicability predicate", () => {
    const when = () => true;
    const projectResult = (_args: Record<string, unknown>, result: unknown) =>
      result;

    expect(
      normalizeActionChatUIConfig({
        renderer: "mail.draft-created",
        when,
        projectResult,
      }),
    ).toEqual({ renderer: "mail.draft-created", when, projectResult });
  });
});
