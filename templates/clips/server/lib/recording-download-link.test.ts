import {
  createScopedAgentAccessGrant,
  signShortLivedToken,
} from "@agent-native/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  trackRows: [] as unknown[],
  footageClipId: null as string | null,
  tracksTable: { recordingId: "recording_tracks.recording_id" },
}));

vi.mock("../db/index.js", () => ({
  getDb: () => ({
    select: () => {
      let rows = mocks.rows;
      const builder = {
        from: (table: unknown) => {
          if (table === mocks.tracksTable) rows = mocks.trackRows;
          return builder;
        },
        where: () => builder,
        limit: async () => rows,
      };
      return builder;
    },
  }),
  schema: {
    recordings: { id: "recordings.id" },
    recordingTracks: mocks.tracksTable,
  },
}));

vi.mock("./context-footage.js", () => ({
  contextClipIdForFootage: async () => mocks.footageClipId,
}));

import {
  createRecordingDownloadGrant,
  createRecordingTrackGrant,
  recordingDownloadRefusal,
  recordingTracksRefusal,
  resolveRecordingDownloadAccess,
  resolveRecordingTrackAccess,
} from "./recording-download-link";

const ready = {
  id: "rec-1",
  ownerEmail: "Owner@Example.com",
  status: "ready",
  failureCode: null,
  trashedAt: null,
  editsJson: null,
  videoUrl: "https://storage.example.com/clips/rec-1/clip.webm",
  sourceAppName: null,
  sourceWindowTitle: null,
};

const withRedaction = JSON.stringify({
  version: 1,
  trims: [],
  overlays: [
    {
      id: "redact-1",
      kind: "redact",
      startMs: 0,
      endMs: 1_000,
      keys: [{ atMs: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
    },
  ],
});

function grantFor(recordingId = "rec-1", ownerEmail = "owner@example.com") {
  return createRecordingDownloadGrant({
    recordingId,
    ownerEmail,
    ttlSeconds: 600,
  }).token;
}

beforeEach(() => {
  mocks.rows = [ready];
  mocks.trackRows = [];
  mocks.footageClipId = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveRecordingDownloadAccess", () => {
  it("lets a link through for the recording and owner it was made for", async () => {
    await expect(
      resolveRecordingDownloadAccess("rec-1", grantFor()),
    ).resolves.toEqual({ ok: true, recording: ready });
  });

  it("still serves the flattened video of a rich recording", async () => {
    const rich = {
      ...ready,
      mediaFormat: "rich",
      richManifestUrl: "https://storage.example.com/clips/rec-1/manifest.json",
    };
    mocks.rows = [rich];
    await expect(
      resolveRecordingDownloadAccess("rec-1", grantFor()),
    ).resolves.toEqual({ ok: true, recording: rich });
  });

  it("stops a link once it expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T12:00:00.000Z"));
    const token = grantFor();

    vi.setSystemTime(new Date("2026-10-26T12:09:59.000Z"));
    await expect(
      resolveRecordingDownloadAccess("rec-1", token),
    ).resolves.toMatchObject({ ok: true });

    vi.setSystemTime(new Date("2026-10-26T12:10:01.000Z"));
    await expect(
      resolveRecordingDownloadAccess("rec-1", token),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "link_expired",
      statusCode: 410,
    });
  });

  it("refuses a link made for another recording", async () => {
    await expect(
      resolveRecordingDownloadAccess("rec-1", grantFor("rec-2")),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "link_invalid",
      statusCode: 403,
    });
  });

  it("refuses a link once the recording has another owner", async () => {
    const token = grantFor();
    mocks.rows = [{ ...ready, ownerEmail: "someone-else@example.com" }];

    await expect(
      resolveRecordingDownloadAccess("rec-1", token),
    ).resolves.toMatchObject({ ok: false, errorCode: "link_invalid" });
  });

  it("does not take a share-with-agents token or a share-password token", async () => {
    const agentToken = createScopedAgentAccessGrant({
      resourceKind: "clip-agent-context",
      resourceId: "rec-1",
      viewerEmail: "owner@example.com",
    }).token;
    const passwordToken = signShortLivedToken({ resourceId: "rec-1" });

    for (const token of [agentToken, passwordToken]) {
      await expect(
        resolveRecordingDownloadAccess("rec-1", token),
      ).resolves.toMatchObject({ ok: false, errorCode: "link_invalid" });
    }
  });

  it("refuses an altered link", async () => {
    const [payload, signature] = grantFor().split(".");
    const forged = `${Buffer.from(
      JSON.stringify({ e: Math.floor(Date.now() / 1000) + 86_400 }),
    ).toString("base64url")}.${signature}`;

    expect(payload).not.toBe(forged.split(".")[0]);
    await expect(
      resolveRecordingDownloadAccess("rec-1", forged),
    ).resolves.toMatchObject({ ok: false, errorCode: "link_invalid" });
  });

  it("answers not found for a missing recording", async () => {
    mocks.rows = [];

    await expect(
      resolveRecordingDownloadAccess("rec-1", grantFor()),
    ).resolves.toMatchObject({ ok: false, statusCode: 404 });
  });

  it("does not serve earlier screen time attached to a clip", async () => {
    mocks.footageClipId = "clip-1";

    await expect(
      resolveRecordingDownloadAccess("rec-1", grantFor()),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "footage_not_downloadable",
      statusCode: 404,
    });
  });

  it("rechecks the recording when the link is used", async () => {
    const token = grantFor();
    mocks.rows = [{ ...ready, trashedAt: "2026-10-26T12:00:00.000Z" }];

    await expect(
      resolveRecordingDownloadAccess("rec-1", token),
    ).resolves.toMatchObject({ ok: false, errorCode: "not_found" });
  });
});

describe("recordingDownloadRefusal", () => {
  it("allows a ready recording with a stored video", () => {
    expect(recordingDownloadRefusal(ready)).toBeNull();
  });

  it.each([
    [{ trashedAt: "2026-10-26T12:00:00.000Z" }, "not_found", 404],
    [{ failureCode: "taken_down" }, "not_found", 404],
    [{ status: "processing" }, "not_ready", 409],
    [{ status: "uploading" }, "not_ready", 409],
    [{ videoUrl: null }, "no_video_file", 422],
    [
      {
        videoUrl: "https://www.loom.com/embed/0123456789abcdef0123456789abcdef",
      },
      "no_video_file",
      422,
    ],
    [{ editsJson: withRedaction }, "redaction_pending", 409],
    [{ editsJson: "{not json" }, "redaction_pending", 409],
  ])("refuses %j as %s", (change, errorCode, statusCode) => {
    expect(recordingDownloadRefusal({ ...ready, ...change })).toMatchObject({
      errorCode,
      statusCode,
    });
  });
});

describe("resolveRecordingTrackAccess", () => {
  const rich = {
    ...ready,
    mediaFormat: "rich",
    richManifestUrl: "https://storage.example.com/clips/rec-1/manifest.json",
  };
  const screen = {
    url: "https://storage.example.com/clips/rec-1.track-screen",
    contentType: "video/mp4",
  };
  const trackGrant = (
    file: "screen" | "mic" | "manifest",
    ownerEmail = "owner@example.com",
  ) =>
    createRecordingTrackGrant({
      recordingId: "rec-1",
      ownerEmail,
      file,
      ttlSeconds: 600,
    }).token;

  beforeEach(() => {
    mocks.rows = [rich];
    mocks.trackRows = [screen];
  });

  it("serves the track a link was made for, with its stored type", async () => {
    await expect(
      resolveRecordingTrackAccess("rec-1", "screen", trackGrant("screen")),
    ).resolves.toMatchObject({
      ok: true,
      url: screen.url,
      contentType: "video/mp4",
    });
  });

  it("serves the manifest from the recording row", async () => {
    await expect(
      resolveRecordingTrackAccess("rec-1", "manifest", trackGrant("manifest")),
    ).resolves.toMatchObject({
      ok: true,
      url: rich.richManifestUrl,
      contentType: "application/json",
    });
  });

  it("refuses a link made for another track, another owner, or the video", async () => {
    for (const token of [
      trackGrant("mic"),
      trackGrant("screen", "someone@example.com"),
      grantFor(),
    ]) {
      await expect(
        resolveRecordingTrackAccess("rec-1", "screen", token),
      ).resolves.toMatchObject({ ok: false, errorCode: "link_invalid" });
    }
  });

  it("does not open the video with a track link", async () => {
    await expect(
      resolveRecordingDownloadAccess("rec-1", trackGrant("screen")),
    ).resolves.toMatchObject({ ok: false, errorCode: "link_invalid" });
  });

  it("stops a track link once it expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T12:00:00.000Z"));
    const token = trackGrant("screen");
    vi.setSystemTime(new Date("2026-10-26T12:10:01.000Z"));
    await expect(
      resolveRecordingTrackAccess("rec-1", "screen", token),
    ).resolves.toMatchObject({ ok: false, errorCode: "link_expired" });
  });

  it("refuses a track the recording doesn't have", async () => {
    mocks.trackRows = [];
    await expect(
      resolveRecordingTrackAccess("rec-1", "screen", trackGrant("screen")),
    ).resolves.toMatchObject({ ok: false, errorCode: "no_tracks" });
  });
});

describe("recordingTracksRefusal", () => {
  const rich = {
    mediaFormat: "rich",
    richManifestUrl: "https://storage.example.com/clips/rec-1/manifest.json",
    editsJson: null,
  };

  it("allows a rich recording", () => {
    expect(recordingTracksRefusal(rich)).toBeNull();
  });

  it("refuses a flat recording, the Trash, and pending redactions", () => {
    expect(
      recordingTracksRefusal({ ...rich, mediaFormat: "flat" })?.errorCode,
    ).toBe("no_tracks");
    expect(
      recordingTracksRefusal({ ...rich, trashedAt: "2026-10-26T12:00:00Z" })
        ?.errorCode,
    ).toBe("not_found");
    expect(
      recordingTracksRefusal({ ...rich, editsJson: withRedaction })?.errorCode,
    ).toBe("redaction_pending");
  });

  it("refuses a recording with a burned redaction, even if a track was left behind", () => {
    expect(
      recordingTracksRefusal({
        ...rich,
        editsJson: JSON.stringify({ burnedRedactions: [{ id: "redact-1" }] }),
      })?.errorCode,
    ).toBe("no_tracks");
  });
});
