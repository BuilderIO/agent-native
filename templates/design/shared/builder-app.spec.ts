import { beforeEach, describe, expect, it, vi } from "vitest";

// What the request has stored. The mocks below answer the way core does: a
// run is authorized by a Builder sign-in or a private key, while the old
// "complete connection" answer needs the private and public key together.
const stored = vi.hoisted(() => ({
  oauthGrant: false,
  privateKey: false,
  publicKey: false,
}));
const mocks = vi.hoisted(() => ({
  canAuthorizeBuilderApiRequest: vi.fn(),
  resolveHasCompleteBuilderConnection: vi.fn(),
  resolveIsBuilderBranchingEnabled: vi.fn(),
  resolveBuilderBranchProjectId: vi.fn(),
  getRequestUserEmail: vi.fn(),
}));

vi.mock("@agent-native/core/server", () => ({
  canAuthorizeBuilderApiRequest: mocks.canAuthorizeBuilderApiRequest,
  resolveHasCompleteBuilderConnection:
    mocks.resolveHasCompleteBuilderConnection,
  resolveIsBuilderBranchingEnabled: mocks.resolveIsBuilderBranchingEnabled,
  resolveBuilderBranchProjectId: mocks.resolveBuilderBranchProjectId,
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

import { resolveBuilderStatus } from "./builder-app.js";

describe("resolveBuilderStatus", () => {
  beforeEach(() => {
    stored.oauthGrant = false;
    stored.privateKey = false;
    stored.publicKey = false;
    mocks.canAuthorizeBuilderApiRequest
      .mockReset()
      .mockImplementation(async () => stored.oauthGrant || stored.privateKey);
    mocks.resolveHasCompleteBuilderConnection
      .mockReset()
      .mockImplementation(async () => stored.privateKey && stored.publicKey);
    mocks.resolveIsBuilderBranchingEnabled.mockReset().mockResolvedValue(true);
    mocks.resolveBuilderBranchProjectId
      .mockReset()
      .mockResolvedValue("project-1");
    mocks.getRequestUserEmail.mockReset().mockReturnValue("owner@example.com");
  });

  it("counts a Builder sign-in with no key pair as connected", async () => {
    stored.oauthGrant = true;

    expect(await resolveBuilderStatus()).toMatchObject({ connected: true });
  });

  it("counts a private and public key pair as connected", async () => {
    stored.privateKey = true;
    stored.publicKey = true;

    expect(await resolveBuilderStatus()).toMatchObject({ connected: true });
  });

  it("reports not connected when there is neither a sign-in nor a key", async () => {
    expect(await resolveBuilderStatus()).toMatchObject({ connected: false });
  });

  it("asks whether the Builder agent run the actions make next would be authorized", async () => {
    stored.oauthGrant = true;

    await resolveBuilderStatus();

    expect(mocks.canAuthorizeBuilderApiRequest).toHaveBeenCalledWith(
      "builder:agents:run",
    );
  });

  it("passes the project and requester through next to the connection", async () => {
    stored.oauthGrant = true;
    mocks.resolveIsBuilderBranchingEnabled.mockResolvedValue(false);
    mocks.resolveBuilderBranchProjectId.mockResolvedValue("");
    mocks.getRequestUserEmail.mockReturnValue(undefined);

    expect(await resolveBuilderStatus()).toEqual({
      connected: true,
      builderEnabled: false,
      branchProjectId: "",
      ownerEmail: null,
    });
  });

  it("fails loudly when the connection lookup throws instead of reporting not connected", async () => {
    stored.oauthGrant = true;
    mocks.canAuthorizeBuilderApiRequest.mockRejectedValue(
      new Error("Builder credential store is unreadable"),
    );

    await expect(resolveBuilderStatus()).rejects.toThrow(
      "Builder credential store is unreadable",
    );
  });
});
