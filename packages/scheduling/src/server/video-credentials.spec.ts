import { afterEach, describe, expect, it } from "vitest";

import { BookingLifecycleError } from "./booking-service.js";
import {
  isWorkspaceConnectionRef,
  resolveVideoCredential,
  setVideoCredentialResolver,
  WORKSPACE_CONNECTION_PREFIX,
} from "./video-credentials.js";

afterEach(() => setVideoCredentialResolver(null));

const failure = (fn: () => Promise<unknown>) =>
  fn().catch((error) => error as BookingLifecycleError);

describe("video credential resolution", () => {
  it("recognizes only the workspace reference format", () => {
    expect(isWorkspaceConnectionRef(`${WORKSPACE_CONNECTION_PREFIX}abc`)).toBe(
      true,
    );
    expect(isWorkspaceConnectionRef("legacy-credential-id")).toBe(false);
    expect(isWorkspaceConnectionRef(null)).toBe(false);
  });

  it("passes a legacy credential id through untouched", async () => {
    const resolved = await resolveVideoCredential(
      "legacy-credential-id",
      "zoom_video",
    );
    expect(resolved).toEqual({ credentialId: "legacy-credential-id" });
  });

  it("resolves a workspace ref through the installed resolver and keeps the ref", async () => {
    const asked: Array<{ connectionId: string; providerKind: string }> = [];
    setVideoCredentialResolver(async (ref) => {
      asked.push(ref);
      return { accountId: "acct-1", accessToken: "secret-value-here" };
    });
    const resolved = await resolveVideoCredential(
      `${WORKSPACE_CONNECTION_PREFIX}conn-1`,
      "zoom_video",
    );
    expect(asked).toEqual([
      { connectionId: "conn-1", providerKind: "zoom_video" },
    ]);
    expect(resolved?.credentialId).toBe(`${WORKSPACE_CONNECTION_PREFIX}conn-1`);
    expect(resolved?.credentials).toEqual({
      accountId: "acct-1",
      accessToken: "secret-value-here",
    });
  });

  it("refuses a workspace ref when no resolver is installed", async () => {
    const error = await failure(() =>
      resolveVideoCredential(
        `${WORKSPACE_CONNECTION_PREFIX}conn-1`,
        "zoom_video",
      ),
    );
    expect(error).toBeInstanceOf(BookingLifecycleError);
    expect(error.errorCode).toBe("video_meeting_creation_failed");
  });

  it("refuses when the resolver answers nothing, and never falls back", async () => {
    setVideoCredentialResolver(async () => null);
    const empty = await failure(() =>
      resolveVideoCredential(
        `${WORKSPACE_CONNECTION_PREFIX}conn-1`,
        "zoom_video",
      ),
    );
    expect(empty.errorCode).toBe("video_meeting_creation_failed");

    setVideoCredentialResolver(async () => ({}));
    const blank = await failure(() =>
      resolveVideoCredential(
        `${WORKSPACE_CONNECTION_PREFIX}conn-1`,
        "zoom_video",
      ),
    );
    expect(blank.errorCode).toBe("video_meeting_creation_failed");
  });

  it("turns a resolver refusal into the typed failure rather than an exception", async () => {
    setVideoCredentialResolver(async () => {
      throw Object.assign(new Error("forbidden"), { statusCode: 403 });
    });
    const error = await failure(() =>
      resolveVideoCredential(
        `${WORKSPACE_CONNECTION_PREFIX}conn-1`,
        "zoom_video",
      ),
    );
    expect(error).toBeInstanceOf(BookingLifecycleError);
    expect(error.statusCode).toBe(502);
  });

  it("refuses an empty connection id", async () => {
    setVideoCredentialResolver(async () => ({ accountId: "a" }));
    const error = await failure(() =>
      resolveVideoCredential(`${WORKSPACE_CONNECTION_PREFIX}   `, "zoom_video"),
    );
    expect(error.errorCode).toBe("video_meeting_creation_failed");
  });
});
