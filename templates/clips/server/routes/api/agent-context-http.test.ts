import { createApp, toWebHandler } from "h3";
import { describe, expect, it, vi } from "vitest";
const access = vi.hoisted(() => ({ editsJson: "{" }));

vi.mock("../../lib/public-agent-context.js", () => ({
  applyAgentJsonHeaders: vi.fn(),
  loadPublicAgentAccess: async () => ({
    ok: true,
    access: {
      recording: { id: "rec", durationMs: 1000, editsJson: access.editsJson },
      viewerIsOwner: true,
    },
  }),
  canReadAppActivityEvents: async () => true,
  loadAgentTranscript: async () => {
    throw Object.assign(new Error("unsafe"), {
      code: "EDITED_TRANSCRIPT_UNAVAILABLE",
    });
  },
  buildPublicAgentContext: () => ({
    instructions: ["Use transcript.segments"],
    transcript: { fullText: "unsafe" },
    commentCount: 0,
    commentsTruncated: false,
    reactionCount: 0,
    reactionsTruncated: false,
    recommendedFrames: [{ atMs: 0 }],
    apis: { frame: { urlTemplate: "/frame" } },
  }),
  MAX_PUBLIC_AGENT_HISTORY_ITEMS: 100,
  queryString: (value: unknown) => (typeof value === "string" ? value : ""),
  CLIPS_AGENT_ACCESS_PARAM: "agent_access",
}));
vi.mock("../../db/index.js", () => ({ getDb: vi.fn(), schema: {} }));
vi.mock("../../lib/user-identities.js", () => ({
  hydrateCommentAuthorNames: async (rows: unknown[]) => rows,
}));
vi.mock("../../lib/app-activity.js", () => ({
  loadRecordingAppActivity: vi.fn(),
}));

import activityHandler from "./agent-app-activity.json.get";
import handler from "./agent-context.json.get";

describe("agent context HTTP failure", () => {
  it("serializes an invalid edited timeline as unavailable, not missing", async () => {
    access.editsJson = "{";
    const app = createApp();
    app.use(handler);
    const response = await toWebHandler(app)(
      new Request("http://localhost/?id=rec"),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      failureKind: "unavailable",
      error: expect.stringContaining("clip exists"),
    });
  });
  it("serializes withheld activity for a cut timeline", async () => {
    access.editsJson = JSON.stringify({
      trims: [{ startMs: 100, endMs: 200, excluded: true }],
    });
    const app = createApp();
    app.use(activityHandler);
    const response = await toWebHandler(app)(
      new Request("http://localhost/?id=rec"),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      failureKind: "unavailable",
      error: expect.stringContaining("clip exists"),
    });
  });
  it("returns frame discovery when an edited transcript is unsafe", async () => {
    access.editsJson = JSON.stringify({
      trims: [{ startMs: 100, endMs: 200, excluded: true }],
    });
    const app = createApp();
    app.use(handler);
    const response = await toWebHandler(app)(
      new Request("http://localhost/?id=rec"),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      commentCount: null,
      commentsTruncated: null,
      reactionCount: null,
      reactionsTruncated: null,
      transcript: { status: "unavailable", segments: [] },
      recommendedFrames: [{ atMs: 0 }],
      apis: { frame: { urlTemplate: "/frame" } },
    });
    expect(JSON.stringify(body)).not.toContain("unsafe");
  });
});
