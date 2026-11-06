import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), access: vi.fn() }));
vi.mock("@agent-native/core/org", () => ({
  getOrgContext: async () => ({
    email: "viewer@example.test",
    orgId: "org-one",
  }),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.access,
  ForbiddenError: class ForbiddenError extends Error {},
}));
vi.mock("../../actions/list-recordings.js", () => ({
  default: { run: mocks.list },
  listRecordingsSchema: { parse: (input: unknown) => input },
}));
vi.mock("./composer-reference-messages.js", () => ({
  composerReferenceMessages: async () => ({
    authentication: "Sign in",
    invalid: "Invalid reference",
    unavailable: "Reference unavailable",
  }),
}));
vi.mock("./recording-share-grant.js", () => ({
  hasExplicitRecordingShare: async () => true,
}));
import type { H3Event } from "h3";

import {
  searchRecordingReferences,
  validateRecordingReferences,
} from "./composer-references.js";
describe("recording references", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("uses the bounded authorized list and excludes password-locked recordings", async () => {
    mocks.list.mockResolvedValue({
      recordings: [
        {
          id: "clip-one",
          title: "Review",
          description: "x".repeat(800),
          ownerEmail: "viewer@example.test",
          hasPassword: false,
          videoUrl: "private video",
          transcript: "private transcript",
        },
        {
          id: "locked",
          title: "Locked",
          hasPassword: true,
          ownerEmail: "someone@example.test",
        },
      ],
    });
    const result = await searchRecordingReferences("review", {} as H3Event);
    expect(mocks.list).toHaveBeenCalledWith(
      { view: "all", search: "review", limit: 20, includeMedia: false },
      {
        caller: "frontend",
        userEmail: "viewer@example.test",
        orgId: "org-one",
      },
    );
    expect(result).toEqual([
      {
        id: "recording:clip-one",
        label: "Review",
        description: "x".repeat(500),
        refType: "recording",
        refId: "clip-one",
        refPath: "/r/clip-one",
        icon: "video",
      },
    ]);
    mocks.list.mockRejectedValueOnce(new Error("read failed"));
    await expect(
      searchRecordingReferences("review", {} as H3Event),
    ).rejects.toThrow("read failed");
  });
  it("rejects a selected recording that expired after the picker loaded", async () => {
    mocks.access.mockResolvedValue({
      role: "viewer",
      resource: {
        visibility: "org",
        password: null,
        expiresAt: "2000-01-01T00:00:00Z",
        trashedAt: null,
        editsJson: null,
      },
    });
    await expect(
      validateRecordingReferences([
        {
          type: "mention",
          refType: "recording",
          refId: "clip-one",
          name: "Review",
          path: "/r/clip-one",
          source: "recording",
        },
      ]),
    ).rejects.toThrow("Reference unavailable");
  });
});
