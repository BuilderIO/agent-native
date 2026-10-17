import { describe, expect, it, vi } from "vitest";

const signEmbedSessionToken = vi.hoisted(() =>
  vi.fn(() => "signed-visual-edit-bootstrap"),
);
const getRequestContext = vi.hoisted(() =>
  vi.fn(() => ({ requestOrigin: "https://design.example.com" })),
);

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));

vi.mock("@agent-native/core", () => ({
  fail: (message: string) => {
    throw new Error(message);
  },
}));

vi.mock("@agent-native/core/server", () => ({
  signEmbedSessionToken,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestContext,
}));

import action from "./issue-visual-edit-bootstrap.js";

describe("issue-visual-edit-bootstrap", () => {
  it("mints a short-lived page capability without an account identity", async () => {
    const result = await action.run(
      {},
      {
        caller: "frontend",
        requestHeaders: new Headers({
          origin: "https://design.example.com",
          "sec-fetch-site": "same-origin",
        }),
      },
    );

    expect(signEmbedSessionToken).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: expect.stringMatching(
          /^bootstrap\+[A-Za-z0-9_-]{32}@local\.visual-edit\.agent-native\.invalid$/,
        ),
        targetPath: "/visual-edit",
        audienceHost: "design.example.com",
        scope: expect.stringMatching(
          /^capability:visual-edit-bootstrap:[A-Za-z0-9_-]{32}$/,
        ),
        ttlSeconds: 300,
      }),
    );
    expect(result).toEqual({
      token: "signed-visual-edit-bootstrap",
      challenge: expect.stringMatching(/^[A-Za-z0-9_-]{32}$/),
    });
  });

  it("rejects bootstrap calls without same-origin browser metadata", async () => {
    signEmbedSessionToken.mockClear();
    await expect(
      action.run(
        {},
        {
          caller: "frontend",
          requestHeaders: new Headers({ "sec-fetch-site": "same-origin" }),
        },
      ),
    ).rejects.toThrow(/same-origin Design page/);
    expect(signEmbedSessionToken).not.toHaveBeenCalled();
  });
});
