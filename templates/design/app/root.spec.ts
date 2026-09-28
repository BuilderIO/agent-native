// @vitest-environment happy-dom

import { getEmbedAuthToken } from "@agent-native/core/client/host";
import { EMBED_TOKEN_QUERY_PARAM } from "@agent-native/core/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/host")>()),
  getEmbedAuthToken: vi.fn(() => null),
}));

import { computeSessionBypass } from "./root";

describe("computeSessionBypass", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.mocked(getEmbedAuthToken).mockReturnValue(null);
  });

  it("does not bypass for the bare embedded=1 flag with no token", () => {
    window.history.replaceState(null, "", "/home?embedded=1&chatFirst=1");
    expect(computeSessionBypass("/home")).toBe(false);
  });

  it("bypasses when a real embed token is present", () => {
    vi.mocked(getEmbedAuthToken).mockReturnValue("signed-token");
    window.history.replaceState(
      null,
      "",
      `/home?embedded=1&${EMBED_TOKEN_QUERY_PARAM}=signed-token`,
    );
    expect(computeSessionBypass("/home")).toBe(true);
  });

  it("still bypasses public design app routes with no embed credential", () => {
    expect(computeSessionBypass("/visual-edit/abc123")).toBe(true);
  });
});
