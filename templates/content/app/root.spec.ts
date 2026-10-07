// @vitest-environment happy-dom

import { appBasePath } from "@agent-native/core/client/api-path";
import { getEmbedAuthToken } from "@agent-native/core/client/host";
import { EMBED_TOKEN_QUERY_PARAM } from "@agent-native/core/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/host")>()),
  getEmbedAuthToken: vi.fn(() => null),
}));

vi.mock("@agent-native/core/client/api-path", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/api-path")
  >()),
  appBasePath: vi.fn(() => "/content"),
}));

import { computeSessionBypass, isContentEditorPath } from "./root";

describe("Content editor session policy", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.mocked(getEmbedAuthToken).mockReturnValue(null);
    vi.mocked(appBasePath).mockReturnValue("/content");
  });

  it("opens document and database editors with a scoped embed token", () => {
    vi.mocked(getEmbedAuthToken).mockReturnValue("scoped-embed-ticket");
    window.history.replaceState(
      null,
      "",
      `/page/database-page?databaseId=db-1&${EMBED_TOKEN_QUERY_PARAM}=scoped-embed-ticket`,
    );

    expect(isContentEditorPath("/page/document-1")).toBe(true);
    expect(isContentEditorPath("/page/database-page")).toBe(true);
    expect(isContentEditorPath("/content/page/document-1")).toBe(true);
    expect(isContentEditorPath("/content/page/database-page")).toBe(true);
    expect(computeSessionBypass("/page/database-page")).toBe(true);
    expect(computeSessionBypass("/content/page/document-1")).toBe(true);
  });

  it("keeps the session gate without a ticket or outside the editor route", () => {
    window.history.replaceState(null, "", "/page/document-1?embedded=1");
    expect(computeSessionBypass("/page/document-1")).toBe(false);

    vi.mocked(getEmbedAuthToken).mockReturnValue("scoped-embed-ticket");
    expect(computeSessionBypass("/settings/agent")).toBe(false);
    expect(computeSessionBypass("/page/document-1/history")).toBe(false);
    expect(isContentEditorPath("/page")).toBe(false);
  });
});
