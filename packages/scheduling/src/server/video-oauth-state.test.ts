import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  signVideoOAuthState,
  verifyVideoOAuthState,
} from "./video-oauth-state.js";

const ORIGINAL_SECRET = process.env.BETTER_AUTH_SECRET;

describe("video-oauth-state", () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "test-secret-do-not-use-in-prod";
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = ORIGINAL_SECRET;
  });

  it("signs and verifies a state for the same user + kind", () => {
    const state = signVideoOAuthState({
      kind: "zoom_video",
      userEmail: "alice@example.com",
    });
    expect(
      verifyVideoOAuthState({
        state,
        kind: "zoom_video",
        userEmail: "alice@example.com",
      }),
    ).toBe(true);
  });

  it("rejects a state forged for a different user", () => {
    const state = signVideoOAuthState({
      kind: "zoom_video",
      userEmail: "alice@example.com",
    });
    expect(
      verifyVideoOAuthState({
        state,
        kind: "zoom_video",
        userEmail: "mallory@example.com",
      }),
    ).toBe(false);
  });

  it("rejects a state cross-bound to a different kind", () => {
    const state = signVideoOAuthState({
      kind: "zoom_video",
      userEmail: "alice@example.com",
    });
    expect(
      verifyVideoOAuthState({
        state,
        kind: "google_meet",
        userEmail: "alice@example.com",
      }),
    ).toBe(false);
  });

  it("rejects empty / malformed state", () => {
    expect(
      verifyVideoOAuthState({
        state: undefined,
        kind: "zoom_video",
        userEmail: "alice@example.com",
      }),
    ).toBe(false);
    expect(
      verifyVideoOAuthState({
        state: "",
        kind: "zoom_video",
        userEmail: "alice@example.com",
      }),
    ).toBe(false);
    expect(
      verifyVideoOAuthState({
        state: "garbage",
        kind: "zoom_video",
        userEmail: "alice@example.com",
      }),
    ).toBe(false);
    expect(
      verifyVideoOAuthState({
        state: "a.b.c.d.e",
        kind: "zoom_video",
        userEmail: "alice@example.com",
      }),
    ).toBe(false);
  });

  it("rejects expired state", () => {
    const state = signVideoOAuthState({
      kind: "zoom_video",
      userEmail: "alice@example.com",
    });
    expect(
      verifyVideoOAuthState({
        state,
        kind: "zoom_video",
        userEmail: "alice@example.com",
        ttlMs: -1, // every state is "older" than -1 ms ago.
      }),
    ).toBe(false);
  });

  it("is case-insensitive on email but rejects mismatched casing if secret rotates", () => {
    const state = signVideoOAuthState({
      kind: "zoom_video",
      userEmail: "Alice@Example.COM",
    });
    expect(
      verifyVideoOAuthState({
        state,
        kind: "zoom_video",
        userEmail: "alice@example.com",
      }),
    ).toBe(true);
  });
});
