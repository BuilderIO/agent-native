import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requestEmailChange } from "./change-email.js";

// the change-email surface answered with a blanket "could not
// send confirmation" even when the auth server said why. The request now carries
// the server's own sentence to the caller; a body without one keeps the old
// generic failure so nothing is invented.
const fetchMock = vi.fn();

function reply(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("requestEmailChange", () => {
  it("passes the server's reason through", async () => {
    reply(503, {
      error: "Changing your email requires a configured email provider.",
    });
    await expect(requestEmailChange("next@example.test")).rejects.toThrow(
      /requires a configured email provider/,
    );
  });

  it("falls back to the generic failure when the body names nothing", async () => {
    reply(401, {});
    await expect(requestEmailChange("next@example.test")).rejects.toThrow(
      /^change-email failed$/,
    );
  });

  it("resolves on the auth server's accepted shape", async () => {
    reply(200, { status: true });
    await expect(requestEmailChange("next@example.test")).resolves.toBe(
      undefined,
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/_agent-native/auth/ba/change-email");
    expect(init.method).toBe("POST");
  });
});
