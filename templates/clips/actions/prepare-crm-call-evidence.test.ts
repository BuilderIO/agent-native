import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  origin: "https://clips.example.test",
  resource: {
    id: "clip-1",
    createdAt: "2026-07-21T18:00:00.000Z",
    archivedAt: null as string | null,
    trashedAt: null as string | null,
  },
}));

vi.mock("@agent-native/core/server", () => ({
  getRequestContext: () => ({ requestOrigin: state.origin }),
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: vi.fn(async () => ({ resource: state.resource })),
}));

vi.mock("../server/lib/public-agent-context.js", () => ({
  getServerAppBasePath: () => "/clips",
}));

import action from "./prepare-crm-call-evidence.js";

describe("prepare-crm-call-evidence", () => {
  beforeEach(() => {
    state.origin = "https://clips.example.test";
    state.resource = {
      id: "clip-1",
      createdAt: "2026-07-21T18:00:00.000Z",
      archivedAt: null,
      trashedAt: null,
    };
  });

  it("returns only a bounded durable recording reference", async () => {
    await expect(action.run({ recordingId: "clip-1" })).resolves.toEqual({
      sourceApp: "clips",
      artifactType: "call-evidence",
      artifactId: "clip-1",
      sourceUrl: "https://clips.example.test/clips/r/clip-1",
      capturedAt: "2026-07-21T18:00:00.000Z",
    });
  });

  it("fails closed for non-HTTPS deployments and unavailable recordings", async () => {
    state.origin = "http://clips.example.test";
    await expect(action.run({ recordingId: "clip-1" })).rejects.toThrow(
      "HTTPS APP_URL",
    );

    state.origin = "https://clips.example.test";
    state.resource = { ...state.resource, archivedAt: "2026-07-21" };
    await expect(action.run({ recordingId: "clip-1" })).rejects.toThrow(
      "Archived or trashed",
    );
  });
});
