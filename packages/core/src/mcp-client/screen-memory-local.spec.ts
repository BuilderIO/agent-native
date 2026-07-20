import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  configureScreenMemory,
  queryScreenMemoryForAgent,
  queryScreenMemoryContext,
  readScreenMemoryStatus,
} from "./screen-memory-local.js";

async function tempScreenMemoryEnv() {
  const root = await mkdtemp(join(tmpdir(), "screen-memory-"));
  return {
    root,
    options: {
      env: {
        AGENT_NATIVE_SCREEN_MEMORY_DIR: root,
        AGENT_NATIVE_SCREEN_MEMORY_CONFIG: join(root, "feature-config.json"),
      },
      homeDir: root,
      platform: "darwin" as const,
    },
  };
}

async function tempLinuxScreenMemoryEnv() {
  const root = await mkdtemp(join(tmpdir(), "screen-memory-"));
  const dataBase = join(root, ".local", "share", "com.clips.tray");
  return {
    root,
    dataBase,
    options: {
      env: {},
      homeDir: root,
      platform: "linux" as const,
    },
  };
}

describe("local Screen Memory helpers", () => {
  it("defaults to disabled with no local captures", async () => {
    const { options } = await tempScreenMemoryEnv();

    const status = await readScreenMemoryStatus(options);

    expect(status.enabled).toBe(false);
    expect(status.state).toBe("disabled");
    expect(status.captureCount).toBe(0);
    expect(status.config).toMatchObject({
      retentionHours: 8,
      captureMode: "visuals",
      reviewBeforeSending: true,
      agentClipRetention: "forever",
      excludePrivateWindows: false,
    });
    expect(status.config.excludedBundleIds).toContain(
      "com.1password.1password",
    );

    const result = await queryScreenMemoryContext({}, options);
    expect(result.evidence).toEqual([]);
    expect(result.coverage.gaps).toEqual([
      expect.objectContaining({ reason: "no-context-files" }),
    ]);
  });

  it("updates local config and queries bounded context records", async () => {
    const { root, options } = await tempScreenMemoryEnv();
    await writeFile(
      join(root, "context.jsonl"),
      `${JSON.stringify({
        capturedAt: "2026-06-29T12:00:00.000Z",
        appName: "Clips",
        windowTitle: "Settings",
        text: "Screen Memory is enabled",
      })}\n`,
      "utf8",
    );

    const status = await configureScreenMemory(
      {
        enabled: true,
        retentionHours: 72,
        captureMode: "visuals-audio",
        reviewBeforeSending: false,
        agentClipRetention: "7-days",
        excludedBundleIds: [" COM.Example.Secret ", "com.example.secret"],
        excludePrivateWindows: false,
      },
      options,
    );
    const result = await queryScreenMemoryContext(
      { query: "enabled", limit: 5 },
      options,
    );

    expect(status.enabled).toBe(true);
    expect(status.state).toBe("ready");
    expect(status.config).toMatchObject({
      retentionHours: 24,
      captureMode: "visuals-audio",
      reviewBeforeSending: false,
      agentClipRetention: "7-days",
      excludedBundleIds: ["com.example.secret"],
      excludePrivateWindows: false,
    });
    expect(result.count).toBe(1);
    expect(result.items[0]).toMatchObject({
      appName: "Clips",
      windowTitle: "Settings",
      text: "Screen Memory is enabled",
    });
    expect(result.evidence[0]).toMatchObject({
      sourceType: "app-context",
      excerpt: "Screen Memory is enabled",
      jumpTarget: { kind: "screen-memory-moment" },
    });
  });

  it("redacts paths and credentials and logs only a content-free receipt", async () => {
    const { root, options } = await tempScreenMemoryEnv();
    await writeFile(
      join(root, "egress.jsonl"),
      `${JSON.stringify({
        requestId: "legacy-request",
        occurredAt: "2026-06-29T11:59:00.000Z",
        state: "prepared",
        packet: {
          question: "legacy private question",
          evidence: [
            {
              id: "legacy-evidence",
              momentId: "legacy-moment",
              sourceType: "transcript",
              capturedAt: "2026-06-29T11:58:00.000Z",
              excerpt: "legacy private excerpt",
            },
          ],
        },
        evidenceCount: 1,
        packetBytes: 100,
        error: null,
      })}\n`,
    );
    await writeFile(
      join(root, "context.jsonl"),
      `${JSON.stringify({
        capturedAt: "2026-06-29T12:00:00.000Z",
        text: "api_key=super-secret-value",
      })}\n`,
      "utf8",
    );
    const result = await queryScreenMemoryForAgent(
      { query: "api_key=super-secret-value", limit: 5 },
      options,
    );

    expect(result.contextFiles).toEqual([]);
    expect(result.items[0]?.sourceFile).toBe("local-screen-memory");
    expect(result.evidence[0]?.excerpt).toBe("api_key=[REDACTED]");
    expect(result.egress.packet.question).toBe("api_key=[REDACTED]");
    const log = await readFile(join(root, "egress.jsonl"), "utf8");
    const events = log
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.map((event) => event.state)).toEqual([
      "prepared",
      "prepared",
      "completed",
    ]);
    expect(events[1]).toMatchObject({
      operation: "agent-query",
      receipt: {
        evidence: [
          expect.objectContaining({
            id: result.evidence[0]?.id,
            capturedAt: "2026-06-29T12:00:00.000Z",
          }),
        ],
      },
    });
    expect(events[1].receipt).not.toHaveProperty("excerpt");
    expect(events[1].receipt).not.toHaveProperty("question");
    expect(log).not.toContain("super-secret");
    expect(log).not.toContain("legacy private question");
    expect(log).not.toContain("legacy private excerpt");
    expect(events[0]).toMatchObject({
      requestId: "legacy-request",
      receipt: {
        evidence: [
          expect.objectContaining({
            id: "legacy-evidence",
            capturedAt: "2026-06-29T11:58:00.000Z",
          }),
        ],
      },
    });
    expect(log).not.toContain(options.env.AGENT_NATIVE_SCREEN_MEMORY_DIR);
  });

  it("reads linux screen memory data from the app-data directory", async () => {
    const { dataBase, options } = await tempLinuxScreenMemoryEnv();
    const storeDir = join(dataBase, "screen-memory");
    await mkdir(storeDir, { recursive: true });
    await writeFile(
      join(dataBase, "feature-config.json"),
      `${JSON.stringify({
        screenMemory: { enabled: true },
      })}\n`,
      "utf8",
    );
    await writeFile(
      join(storeDir, "context.jsonl"),
      `${JSON.stringify({
        capturedAt: "2026-06-29T12:00:00.000Z",
        appName: "Clips",
        windowTitle: "Linux",
        text: "Screen Memory is visible on Linux",
      })}\n`,
      "utf8",
    );

    const status = await readScreenMemoryStatus(options);
    const result = await queryScreenMemoryContext(
      { query: "linux", limit: 5 },
      options,
    );

    expect(status.enabled).toBe(true);
    expect(status.state).toBe("ready");
    expect(status.contextFiles).toContain(join(storeDir, "context.jsonl"));
    expect(result.count).toBe(1);
    expect(result.items[0]).toMatchObject({
      appName: "Clips",
      windowTitle: "Linux",
      text: "Screen Memory is visible on Linux",
    });
  });

  it("reports stale coverage and bounds excerpts and item output", async () => {
    const { root, options } = await tempScreenMemoryEnv();
    const now = new Date("2026-06-29T12:10:00.000Z");
    await writeFile(
      join(root, "context.jsonl"),
      [
        {
          capturedAt: "2026-06-29T12:00:00.000Z",
          text: "x".repeat(1_300),
        },
        {
          capturedAt: "2026-06-29T11:59:00.000Z",
          text: "second evidence",
        },
        {
          capturedAt: "2026-06-29T11:58:00.000Z",
          text: "third evidence",
        },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n") + "\n",
      "utf8",
    );

    const result = await queryScreenMemoryContext(
      { sinceMinutes: 15, limit: 2 },
      { ...options, now: () => now },
    );

    expect(result.items).toHaveLength(2); // Legacy context remains bounded too.
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[0]?.excerpt).toHaveLength(1_200);
    expect(result.evidence[0]?.excerptTruncated).toBe(true);
    expect(result.truncation).toMatchObject({
      itemLimit: 2,
      returnedItems: 2,
      omittedItems: 1,
      excerptsTruncated: 1,
    });
    expect(result.coverage.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "missing-before-first-evidence" }),
        expect.objectContaining({ reason: "capture-stale" }),
      ]),
    );
  });

  it("normalizes local OCR and transcript fields without inventing either", async () => {
    const { root, options } = await tempScreenMemoryEnv();
    await writeFile(
      join(root, "context.jsonl"),
      `${JSON.stringify({
        capturedAt: "2026-06-29T12:00:00.000Z",
        appName: "Clips",
        text: "legacy app context",
        ocrText: "Visible settings label",
        transcript: "Spoken local words",
        segmentId: "segment-1",
      })}\n${JSON.stringify({
        capturedAt: "2026-06-29T12:01:00.000Z",
        text: "only legacy context",
      })}\n`,
      "utf8",
    );
    await writeFile(join(root, "segment-1.mp4"), "retained-test-media", "utf8");
    await writeFile(
      join(root, "segment-1.json"),
      `${JSON.stringify({
        id: "segment-1",
        startedAt: "2026-06-29T11:59:00.000Z",
        endedAt: "2026-06-29T12:02:00.000Z",
        path: join(root, "segment-1.mp4"),
        bytes: 123,
      })}\n`,
      "utf8",
    );

    const result = await queryScreenMemoryContext({ limit: 10 }, options);

    expect(result.evidence.map((item) => item.sourceType)).toEqual([
      "app-context",
      "transcript",
      "ocr",
    ]);
    expect(result.evidence[1]?.segmentRefs).toEqual([
      {
        id: "segment-1",
        startedAt: "2026-06-29T11:59:00.000Z",
        endedAt: "2026-06-29T12:02:00.000Z",
      },
    ]);
    expect(JSON.stringify(result.evidence)).not.toContain("segment-1.mp4");
    expect(JSON.stringify(result.evidence)).not.toContain('"bytes"');
  });

  it("reads OCR sidecars and exposes incomplete local indexing as coverage gaps", async () => {
    const { root, options } = await tempScreenMemoryEnv();
    await writeFile(
      join(root, "segment-1.ocr.jsonl"),
      `${JSON.stringify({
        schemaVersion: 1,
        segmentId: "segment-1",
        capturedAt: "2026-06-29T12:00:00.000Z",
        offsetMs: 1000,
        source: "ocr",
        ocrText: "Local visible text",
        confidence: 0.9,
        frameWidth: 1920,
        frameHeight: 1080,
      })}\n`,
      "utf8",
    );
    await writeFile(
      join(root, "segment-1.json"),
      `${JSON.stringify({ id: "segment-1", startedAt: "2026-06-29T11:59:00.000Z", endedAt: "2026-06-29T12:02:00.000Z" })}\n`,
      "utf8",
    );
    await writeFile(
      join(root, "segment-1.ocr-status.json"),
      `${JSON.stringify({ state: "failed" })}\n`,
      "utf8",
    );

    const result = await queryScreenMemoryContext(
      { query: "visible" },
      options,
    );
    expect(result.evidence).toEqual([
      expect.objectContaining({
        sourceType: "ocr",
        excerpt: "Local visible text",
      }),
    ]);
    expect(result.coverage.gaps).toContainEqual(
      expect.objectContaining({
        reason: "index-failed",
        startedAt: "2026-06-29T11:59:00.000Z",
      }),
    );
  });

  it("reads local transcript sidecars as transcript evidence", async () => {
    const { root, options } = await tempScreenMemoryEnv();
    await writeFile(
      join(root, "segment-2.transcript.jsonl"),
      `${JSON.stringify({
        schemaVersion: 1,
        segmentId: "segment-2",
        capturedAt: "2026-06-29T12:03:02.000Z",
        source: "mixed-audio",
        startMs: 2000,
        endMs: 3200,
        text: "A locally transcribed sentence",
      })}\n`,
      "utf8",
    );
    await writeFile(
      join(root, "segment-2.json"),
      `${JSON.stringify({ id: "segment-2", startedAt: "2026-06-29T12:03:00.000Z", endedAt: "2026-06-29T12:04:00.000Z" })}\n`,
      "utf8",
    );
    await writeFile(
      join(root, "segment-2.transcript-status.json"),
      `${JSON.stringify({ state: "transcribing" })}\n`,
      "utf8",
    );

    const result = await queryScreenMemoryContext(
      { query: "transcribed" },
      options,
    );
    expect(result.evidence).toEqual([
      expect.objectContaining({
        sourceType: "transcript",
        excerpt: "A locally transcribed sentence",
        segmentRefs: [expect.objectContaining({ id: "segment-2" })],
      }),
    ]);
    expect(result.coverage.gaps).toContainEqual(
      expect.objectContaining({
        reason: "index-pending",
        startedAt: "2026-06-29T12:03:00.000Z",
      }),
    );
  });

  it("never returns evidence backed only by tainted or pruned segments", async () => {
    const { root, options } = await tempScreenMemoryEnv();
    await writeFile(
      join(root, "events.jsonl"),
      [
        {
          segmentId: "segment-tainted",
          capturedAt: "2026-06-29T12:00:10.000Z",
          text: "private excluded window",
        },
        {
          segmentId: "segment-pruned",
          capturedAt: "2026-06-29T12:01:10.000Z",
          text: "already pruned media",
        },
      ]
        .map((row) => JSON.stringify(row))
        .join("\n") + "\n",
      "utf8",
    );
    await writeFile(
      join(root, "segment-tainted.mp4"),
      "retained-test-media",
      "utf8",
    );
    await writeFile(
      join(root, "segment-tainted.json"),
      `${JSON.stringify({
        id: "segment-tainted",
        startedAt: "2026-06-29T12:00:00.000Z",
        endedAt: "2026-06-29T12:01:00.000Z",
        path: join(root, "segment-tainted.mp4"),
        exclusionTainted: true,
      })}\n`,
      "utf8",
    );
    await writeFile(
      join(root, "segment-pruned.json"),
      `${JSON.stringify({
        id: "segment-pruned",
        startedAt: "2026-06-29T12:01:00.000Z",
        endedAt: "2026-06-29T12:02:00.000Z",
        path: join(root, "segment-pruned.mp4"),
      })}\n`,
      "utf8",
    );

    const result = await queryScreenMemoryContext({ limit: 10 }, options);

    expect(result.items).toEqual([]);
    expect(result.evidence).toEqual([]);
    expect(result.coverage.gaps).toContainEqual(
      expect.objectContaining({
        reason: "privacy-excluded-or-unretained",
      }),
    );
  });

  it("joins continuous transcript rows without crossing pauses or audio sources", async () => {
    const { root, options } = await tempScreenMemoryEnv();
    const transcriptRows = [
      {
        schemaVersion: 1,
        segmentId: "segment-3",
        capturedAt: "2026-06-29T12:00:00.000Z",
        source: "microphone",
        startMs: 0,
        endMs: 1_000,
        text: "Clips and screen captures",
      },
      {
        schemaVersion: 1,
        segmentId: "segment-3",
        capturedAt: "2026-06-29T12:00:01.100Z",
        source: "microphone",
        startMs: 1_100,
        endMs: 2_000,
        text: "obey the visibility toggle.",
      },
      {
        schemaVersion: 1,
        segmentId: "segment-3",
        capturedAt: "2026-06-29T12:00:02.100Z",
        source: "system-audio",
        startMs: 2_100,
        endMs: 3_000,
        text: "A different audio source stays separate.",
      },
      {
        schemaVersion: 1,
        segmentId: "segment-3",
        capturedAt: "2026-06-29T12:00:05.100Z",
        source: "microphone",
        startMs: 5_100,
        endMs: 6_000,
        text: "After a real pause stays separate.",
      },
    ];
    await writeFile(
      join(root, "segment-3.transcript.jsonl"),
      `${transcriptRows.map((row) => JSON.stringify(row)).join("\n")}\n`,
      "utf8",
    );
    await writeFile(
      join(root, "segment-3.json"),
      `${JSON.stringify({ id: "segment-3", startedAt: "2026-06-29T12:00:00.000Z", endedAt: "2026-06-29T12:01:00.000Z" })}\n`,
      "utf8",
    );

    const result = await queryScreenMemoryContext({ limit: 10 }, options);
    expect(result.evidence.map((item) => item.excerpt)).toEqual([
      "After a real pause stays separate.",
      "A different audio source stays separate.",
      "Clips and screen captures obey the visibility toggle.",
    ]);

    const crossRowSearch = await queryScreenMemoryContext(
      { query: "captures obey", limit: 10 },
      options,
    );
    expect(crossRowSearch.evidence).toEqual([
      expect.objectContaining({
        sourceType: "transcript",
        excerpt: "Clips and screen captures obey the visibility toggle.",
      }),
    ]);
  });
});
