import { beforeEach, describe, expect, it, vi } from "vitest";

const writeAppState = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../application-state/script-helpers.js", () => ({
  writeAppState,
  appStateKeyForBrowserTab: (key: string, tab: unknown) =>
    typeof tab === "string" ? `${key}:${tab}` : key,
}));
vi.mock("../request-context.js", () => ({
  getRequestRunContext: () => ({ browserTabId: "tab_1" }),
}));

import {
  createOpenSettingsPageTool,
  resolveOpenSettingsPageTarget,
} from "./open-settings-page-tool.js";

describe("open-settings-page", () => {
  beforeEach(() => writeAppState.mockClear());

  it.each([
    [{ page: "model" }, "/settings/model", null],
    [
      { page: "integrations", sub: "builder" },
      "/settings/integrations/builder",
      null,
    ],
    [{ page: "/settings/channels/slack" }, "/settings/channels/slack", null],
    [{ page: "model", anchor: "#limits" }, "/settings/model", "limits"],
    // Today's ids resolve through the redirect table.
    [{ page: "agent" }, "/settings/model", null],
    [{ page: "llm" }, "/settings/model", "llm"],
    [{ page: "keys" }, "/settings/api-keys", null],
    [
      { page: "secrets:OPENAI_API_KEY" },
      "/settings/api-keys",
      "secrets:OPENAI_API_KEY",
    ],
    [{ page: "team" }, "/settings/members", null],
    [{ page: "browser" }, "/settings/integrations/builder", null],
  ])("opens %o at %s", (input, pathname, anchor) => {
    expect(resolveOpenSettingsPageTarget(input)).toMatchObject({
      pathname,
      anchor,
    });
  });

  it("flags an app page it can't confirm and refuses a malformed id", () => {
    expect(resolveOpenSettingsPageTarget({ page: "drafting" })).toMatchObject({
      pathname: "/settings/drafting",
      corePage: false,
    });
    expect(() => resolveOpenSettingsPageTarget({ page: "../../etc" })).toThrow(
      /not a Settings page id/,
    );
  });

  it("writes one tab-scoped URL command that clears the old query", async () => {
    const tool = createOpenSettingsPageTool();
    const result = await tool.run({ page: "model", anchor: "limits" });
    expect(writeAppState).toHaveBeenCalledWith(
      "__set_url__:tab_1",
      expect.objectContaining({
        pathname: "/settings/model",
        hash: "#limits",
        searchParams: {},
        mergeSearchParams: false,
        _writeId: expect.any(String),
      }),
    );
    expect(result).toContain("/settings/model");
  });

  it("requires a page", async () => {
    const tool = createOpenSettingsPageTool();
    await expect(tool.run({})).rejects.toThrow(/page is required/);
    expect(writeAppState).not.toHaveBeenCalled();
  });
});
