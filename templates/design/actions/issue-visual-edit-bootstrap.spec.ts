import { describe, expect, it, vi } from "vitest";

const signEmbedSessionToken = vi.hoisted(() =>
  vi.fn(() => "signed-visual-edit-bootstrap"),
);

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));

vi.mock("@agent-native/core/server", () => ({
  signEmbedSessionToken,
}));

import action from "./issue-visual-edit-bootstrap.js";

describe("issue-visual-edit-bootstrap", () => {
  it("mints a short-lived page capability without an account identity", async () => {
    const result = await action.run({});

    expect(signEmbedSessionToken).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerEmail: expect.stringMatching(
          /^bootstrap\+[A-Za-z0-9_-]{32}@local\.visual-edit\.agent-native\.invalid$/,
        ),
        targetPath: "/visual-edit",
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
});
