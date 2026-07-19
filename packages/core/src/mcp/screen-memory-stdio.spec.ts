import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  appendLocalEvidenceReceipt,
  contactSheetRangeIsValid,
  projectScreenMemoryChapterCandidate,
  redactCredentialText,
  readScreenMemoryChapters,
  readScreenMemoryFrame,
  searchScreenMemoryChapters,
  screenMemoryMcpToolDefinitions,
  selectContactSheetTimestamps,
} from "./screen-memory-stdio.js";

describe("Screen Memory stdio MCP tools", () => {
  it("keeps the legacy tool names while documenting the bounded evidence contract", () => {
    const tools = screenMemoryMcpToolDefinitions();

    expect(tools.map((tool) => tool.name)).toEqual([
      "screen_memory_status",
      "screen_memory_recent_context",
      "screen_memory_recent_segments",
      "screen_memory_search_chapters",
      "screen_memory_frame_at",
      "screen_memory_contact_sheet",
      "screen_memory_request_clip",
      "screen_memory_handoff_status",
    ]);
    expect(
      tools.find((tool) => tool.name === "screen_memory_recent_context")
        ?.description,
    ).toContain("coverage");
    expect(
      tools.find((tool) => tool.name === "screen_memory_recent_context")
        ?.description,
    ).toContain("no media bytes or images");
    expect(
      tools.find((tool) => tool.name === "screen_memory_recent_segments")
        ?.description,
    ).toContain("private Clip handoff boundary");
    expect(
      tools.find((tool) => tool.name === "screen_memory_request_clip")
        ?.description,
    ).toContain("private Clip");
  });

  it("redacts obvious credential-shaped text before an MCP packet can leave", () => {
    const fakeBearer = ["abcdef", "ghijklmnop"].join("");
    expect(
      redactCredentialText(
        `api_key=super-secret-value Bearer ${fakeBearer} sk-abcdefghijklmnop`,
      ),
    ).toBe("api_key=[REDACTED] Bearer [REDACTED] [REDACTED CREDENTIAL]");
  });

  it("parses a complete native chapters manifest and ranks semantic matches deterministically", async () => {
    const store = await mkdtemp(join(tmpdir(), "screen-memory-chapters-"));
    await writeFile(
      join(store, "chapters.json"),
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: "2026-07-18T12:00:00.000Z",
        state: "ready",
        coverage: { gaps: [] },
        chapters: [
          {
            id: "clips",
            startedAt: "2026-07-18T10:00:00.000Z",
            endedAt: "2026-07-18T10:05:00.000Z",
            durationMs: 300000,
            label: "Reviewing Clips Rewind settings",
            summary: "MCP frame tools and retention",
            confidence: 0.8,
            segmentRefs: [],
            evidenceRefs: [{ sourceType: "ocr" }],
            contexts: [{ appName: "Clips" }],
            representativeMoments: [],
            ambiguityReasons: [],
            indexState: "ready",
          },
          {
            id: "content",
            startedAt: "2026-07-18T10:05:00.000Z",
            endedAt: "2026-07-18T10:10:00.000Z",
            durationMs: 300000,
            label: "Testing Content page",
            summary: "Database cards",
            confidence: 0.9,
            segmentRefs: [],
            evidenceRefs: [{ sourceType: "ocr" }],
            contexts: [{ appName: "Content" }],
            representativeMoments: [],
            ambiguityReasons: [],
            indexState: "partial",
          },
        ],
      }),
    );
    const chapters = readScreenMemoryChapters(store);
    expect(chapters?.chapters).toHaveLength(2);
    expect(chapters?.schemaVersion).toBe(1);
    expect(chapters?.chapters[0]).toMatchObject({ revision: 1, aliases: [] });
    expect(
      searchScreenMemoryChapters(chapters!, "rewind frame", 5, "Content").map(
        (chapter) => chapter.id,
      ),
    ).toEqual(["clips"]);
    expect(
      searchScreenMemoryChapters(chapters!, "content", 5, "Clips")[0],
    ).toMatchObject({
      id: "content",
      matchReasons: expect.arrayContaining([
        'matched "content" in chapter or accessibility evidence',
      ]),
    });
  });

  it("parses r5 chapter revisions, exact gaps, aliases, and representative coverage", async () => {
    const store = await mkdtemp(join(tmpdir(), "screen-memory-r5-"));
    await writeFile(
      join(store, "chapters.json"),
      JSON.stringify({
        schemaVersion: 2,
        generatedAt: "2026-07-18T12:00:00.000Z",
        state: "ready",
        coverage: {
          gaps: [
            {
              startedAt: "2026-07-18T10:02:00.000Z",
              endedAt: "2026-07-18T10:03:00.000Z",
              reason: "excluded",
            },
          ],
        },
        chapters: [
          {
            id: "verification",
            revision: 3,
            aliases: ["old-verification"],
            startedAt: "2026-07-18T10:00:00.000Z",
            endedAt: "2026-07-18T10:05:00.000Z",
            label: "Account verification",
            summary: "Browser and Mail verification task",
            accessibilitySummary: "Verify account code in browser",
            accessibilityKeywords: ["verification code"],
            keywords: [],
            confidence: 0.9,
            segmentRefs: [],
            sceneRefs: ["scene-a"],
            evidenceRefs: [
              {
                sourceType: "accessibility",
                sourceKind: "focused-control",
                keywords: [
                  "verification code",
                  ...Array.from(
                    { length: 12 },
                    (_, index) => `filler-${index}`,
                  ),
                  "global data model",
                ],
                confidence: 0.95,
              },
            ],
            contexts: [],
            representativeMoments: [
              {
                momentId: "middle",
                capturedAt: "2026-07-18T10:02:30.000Z",
                segmentId: "segment-a",
                offsetMs: 150000,
                reason: "meaningful internal change",
              },
            ],
            representativeCoverage: {
              coveredScenes: 1,
              totalScenes: 2,
              truncated: true,
            },
            ambiguityReasons: [],
            indexState: "ready",
          },
        ],
      }),
    );
    const document = readScreenMemoryChapters(store);
    expect(document).toMatchObject({
      schemaVersion: 2,
      coverage: { gaps: [{ reason: "excluded" }] },
    });
    expect(document?.chapters[0]).toMatchObject({
      revision: 3,
      aliases: ["old-verification"],
      sceneRefs: [{ id: "scene-a" }],
      representativeCoverage: {
        coveredScenes: 1,
        totalScenes: 2,
        truncated: true,
      },
    });
    expect(document?.chapters[0].evidenceRefs[0].keywords).toContain(
      "global data model",
    );
  });

  it("ranks exact visible evidence above a generic app match and exposes provenance", async () => {
    const document = {
      schemaVersion: 2 as const,
      generatedAt: "2026-07-18T12:00:00.000Z",
      state: "ready",
      coverage: { gaps: [] },
      chapters: [
        {
          id: "generic",
          revision: 1,
          aliases: [],
          startedAt: "2026-07-18T10:00:00.000Z",
          endedAt: "2026-07-18T10:05:00.000Z",
          durationMs: 300000,
          label: "Cursor",
          summary: "Cursor app",
          keywords: [],
          accessibilitySummary: "",
          accessibilityKeywords: [],
          confidence: 1,
          segmentRefs: [],
          sceneRefs: [],
          evidenceRefs: [],
          contexts: [{ appName: "OAuth redirect mismatch - Cursor" }],
          representativeMoments: [],
          ambiguityReasons: [],
          indexState: "ready" as const,
        },
        {
          id: "semantic",
          revision: 2,
          aliases: ["previous-semantic"],
          startedAt: "2026-07-18T10:05:00.000Z",
          endedAt: "2026-07-18T10:10:00.000Z",
          durationMs: 300000,
          label: "Reviewing authentication error",
          summary: "",
          keywords: [],
          accessibilitySummary:
            "OAuth redirect mismatch on account verification",
          accessibilityKeywords: ["OAuth redirect mismatch"],
          confidence: 0.7,
          segmentRefs: [],
          sceneRefs: [{ id: "scene-b" }],
          evidenceRefs: [
            {
              sourceType: "accessibility",
              sourceKind: "document",
              keywords: ["OAuth redirect mismatch"],
              confidence: 0.9,
            },
          ],
          contexts: [{ appName: "Cursor" }],
          representativeMoments: [],
          ambiguityReasons: [],
          indexState: "ready" as const,
        },
      ],
    };
    const result = searchScreenMemoryChapters(
      document,
      "OAuth redirect mismatch",
    );
    expect(result.map((chapter) => chapter.id)).toEqual([
      "semantic",
      "generic",
    ]);
    expect(result[0].matchReasons.join(" ")).toContain("exact phrase");
    expect(result[0].matchProvenance).toMatchObject([
      { sourceType: "accessibility", sourceKind: "document" },
    ]);
    const candidate = projectScreenMemoryChapterCandidate(result[0]);
    expect(candidate).toMatchObject({
      id: "semantic",
      sceneCount: 1,
      evidenceSources: ["accessibility/document"],
    });
    expect(candidate).not.toHaveProperty("segmentRefs");
    expect(candidate).not.toHaveProperty("sceneRefs");
    expect(candidate).not.toHaveProperty("evidenceRefs");
    expect(JSON.stringify(candidate).length).toBeLessThan(4_000);
  });

  it("does not let uncorroborated microphone narration dominate visible work", () => {
    const document = {
      schemaVersion: 2 as const,
      generatedAt: "2026-07-18T12:00:00.000Z",
      state: "ready",
      coverage: { gaps: [] },
      chapters: [
        {
          id: "microphone",
          revision: 1,
          aliases: [],
          startedAt: "2026-07-18T10:00:00.000Z",
          endedAt: "2026-07-18T10:05:00.000Z",
          durationMs: 300000,
          label: "Reading",
          summary: "",
          keywords: [],
          accessibilitySummary: "",
          accessibilityKeywords: [],
          confidence: 1,
          segmentRefs: [],
          sceneRefs: [],
          evidenceRefs: [
            {
              sourceType: "microphone",
              sourceKind: "transcript",
              keywords: ["astronomy comet"],
              confidence: 1,
            },
          ],
          contexts: [],
          representativeMoments: [],
          ambiguityReasons: [],
          indexState: "ready" as const,
        },
        {
          id: "visible",
          revision: 1,
          aliases: [],
          startedAt: "2026-07-18T10:05:00.000Z",
          endedAt: "2026-07-18T10:10:00.000Z",
          durationMs: 300000,
          label: "Astronomy research",
          summary: "Comet observation notes",
          keywords: ["astronomy comet"],
          accessibilitySummary: "Comet observation notebook",
          accessibilityKeywords: [],
          confidence: 0.7,
          segmentRefs: [],
          sceneRefs: [],
          evidenceRefs: [
            {
              sourceType: "ocr",
              keywords: ["astronomy comet"],
              confidence: 0.8,
            },
          ],
          contexts: [],
          representativeMoments: [],
          ambiguityReasons: [],
          indexState: "ready" as const,
        },
      ],
    };
    const result = searchScreenMemoryChapters(document, "astronomy comet");
    expect(result.map((chapter) => chapter.id)).toEqual(["visible"]);
  });

  it("ignores conversational stop words instead of creating generic matches", () => {
    const document = {
      schemaVersion: 2 as const,
      generatedAt: "2026-07-18T12:00:00.000Z",
      state: "ready",
      coverage: { gaps: [] },
      chapters: [
        {
          id: "generic",
          revision: 1,
          aliases: [],
          startedAt: "2026-07-18T10:00:00.000Z",
          endedAt: "2026-07-18T10:05:00.000Z",
          durationMs: 300000,
          label: "Working in an app",
          summary: "the work that was open",
          keywords: [],
          accessibilitySummary: "",
          accessibilityKeywords: [],
          confidence: 0.5,
          segmentRefs: [],
          sceneRefs: [],
          evidenceRefs: [],
          contexts: [],
          representativeMoments: [],
          ambiguityReasons: [],
          indexState: "ready" as const,
        },
      ],
    };
    expect(searchScreenMemoryChapters(document, "the work that was")).toEqual(
      [],
    );
  });

  it("rejects missing or corrupt chapter manifests rather than leaking partial state", async () => {
    const store = await mkdtemp(join(tmpdir(), "screen-memory-chapters-"));
    expect(readScreenMemoryChapters(store)).toBeNull();
    await writeFile(
      join(store, "chapters.json"),
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: "bad",
        state: "ready",
        chapters: [],
      }),
    );
    expect(readScreenMemoryChapters(store)).toBeNull();
  });

  it("selects the clean exact retained segment and returns a mocked local image without its path", async () => {
    const store = await mkdtemp(join(tmpdir(), "screen-memory-frame-"));
    const media = join(store, "private-segment.mp4");
    await writeFile(media, "not really a movie");
    await writeFile(
      join(store, "segment-a.json"),
      JSON.stringify({
        id: "segment-a",
        startedAt: "2020-01-01T00:00:00.000Z",
        endedAt: "2020-01-01T00:01:00.000Z",
        path: media,
        mimeType: "video/mp4",
        bytes: 1,
        durationMs: 60000,
      }),
    );
    const frame = readScreenMemoryFrame(
      store,
      "2020-01-01T00:00:20.000Z",
      (_path, offsetMs) => {
        expect(offsetMs).toBe(20_000);
        return Buffer.from("fake-jpeg");
      },
    );
    expect(frame).toMatchObject({
      timestamp: "2020-01-01T00:00:20.000Z",
      segmentId: "segment-a",
      image: { type: "image", mimeType: "image/jpeg" },
    });
    expect(JSON.stringify(frame)).not.toContain(media);
  });

  it("rejects corrupt or exclusion-tainted segments and prefers representative contact-sheet timestamps", async () => {
    const store = await mkdtemp(join(tmpdir(), "screen-memory-frame-"));
    const media = join(store, "private-segment.mp4");
    await writeFile(media, "not really a movie");
    await writeFile(
      join(store, "segment-a.json"),
      JSON.stringify({
        id: "segment-a",
        startedAt: "2020-01-01T00:00:00.000Z",
        endedAt: "2020-01-01T00:01:00.000Z",
        path: media,
        mimeType: "video/mp4",
        bytes: 1,
        durationMs: 60000,
        exclusionTainted: true,
      }),
    );
    expect(() =>
      readScreenMemoryFrame(store, "2020-01-01T00:00:20.000Z", () =>
        Buffer.from("jpeg"),
      ),
    ).toThrow("excluded");
    expect(
      selectContactSheetTimestamps(
        "2020-01-01T00:00:00.000Z",
        "2020-01-01T00:01:00.000Z",
        3,
        ["2020-01-01T00:00:05.000Z"],
      )[0],
    ).toBe("2020-01-01T00:00:05.000Z");
    expect(
      selectContactSheetTimestamps(
        "2020-01-01T00:00:00.000Z",
        "2020-01-01T00:01:00.000Z",
        3,
        [
          "2020-01-01T00:00:05.000Z",
          "2020-01-01T00:00:25.000Z",
          "2020-01-01T00:00:55.000Z",
        ],
      ),
    ).toContain("2020-01-01T00:00:50.000Z");
    expect(contactSheetRangeIsValid(15 * 60_000, true)).toBe(true);
    expect(contactSheetRangeIsValid(15 * 60_000, false)).toBe(false);
  });

  it("rejects retained-segment paths that escape the configured store", async () => {
    const store = await mkdtemp(join(tmpdir(), "screen-memory-frame-store-"));
    const outside = await mkdtemp(
      join(tmpdir(), "screen-memory-frame-outside-"),
    );
    const outsideMedia = join(outside, "private-segment.mp4");
    const escapedMedia = join(store, "escaped.mp4");
    await writeFile(outsideMedia, "not really a movie");
    await symlink(outsideMedia, escapedMedia);
    await writeFile(
      join(store, "segment-escaped.json"),
      JSON.stringify({
        id: "segment-escaped",
        startedAt: "2020-01-01T00:00:00.000Z",
        endedAt: "2020-01-01T00:01:00.000Z",
        path: escapedMedia,
        mimeType: "video/mp4",
        bytes: 1,
        durationMs: 60000,
      }),
    );
    expect(() =>
      readScreenMemoryFrame(store, "2020-01-01T00:00:20.000Z", () =>
        Buffer.from("jpeg"),
      ),
    ).toThrow("outside the local memory store");
  });

  it("keeps frame activity receipts content-free while retaining bounded provenance", async () => {
    const store = await mkdtemp(join(tmpdir(), "screen-memory-chapters-"));
    appendLocalEvidenceReceipt(store, "frame-at", [
      {
        timestamp: "2026-07-19T12:00:00.000Z",
        segmentId: "segment-opaque-123",
      },
    ]);
    const receipt = await readFile(join(store, "egress.jsonl"), "utf8");
    expect(JSON.parse(receipt)).toMatchObject({
      operation: "frame-at",
      receipt: {
        frames: [
          {
            timestamp: "2026-07-19T12:00:00.000Z",
            segmentId: "segment-opaque-123",
          },
        ],
      },
    });
    expect(receipt).not.toMatch(/\.mp4|mediaPath|reason|"packet"/i);
  });

  it("records every contact-sheet frame timestamp and opaque segment reference", async () => {
    const store = await mkdtemp(join(tmpdir(), "screen-memory-chapters-"));
    appendLocalEvidenceReceipt(store, "contact-sheet", [
      {
        timestamp: "2026-07-19T12:00:00.000Z",
        segmentId: "segment-opaque-123",
      },
      {
        timestamp: "2026-07-19T12:01:00.000Z",
        segmentId: "segment-opaque-456",
      },
    ]);

    const event = JSON.parse(
      await readFile(join(store, "egress.jsonl"), "utf8"),
    );
    expect(event.receipt.frames).toEqual([
      {
        timestamp: "2026-07-19T12:00:00.000Z",
        segmentId: "segment-opaque-123",
      },
      {
        timestamp: "2026-07-19T12:01:00.000Z",
        segmentId: "segment-opaque-456",
      },
    ]);
    expect(JSON.stringify(event)).not.toMatch(/\.mp4|mediaPath|"packet"/i);
  });
});
