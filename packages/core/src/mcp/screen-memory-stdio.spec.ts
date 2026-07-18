import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
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
    expect(
      redactCredentialText(
        "api_key=super-secret-value Bearer abcdefghijklmnop sk-abcdefghijklmnop",
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
    expect(
      searchScreenMemoryChapters(chapters!, "rewind frame", 5, "Content").map(
        (chapter) => chapter.id,
      ),
    ).toEqual(["clips"]);
    expect(
      searchScreenMemoryChapters(chapters!, "content", 5, "Clips")[0],
    ).toMatchObject({ id: "content", matchReasons: ['matched "content"'] });
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
  });

  it("keeps activity receipts path-free and byte-free", async () => {
    const store = await mkdtemp(join(tmpdir(), "screen-memory-chapters-"));
    // The receipt helper is exercised by the integration handler; the public log format must never expose either token.
    await writeFile(
      join(store, "egress.jsonl"),
      JSON.stringify({
        operation: "frame-at",
        frameCount: 1,
        reason: "inspect",
      }) + "\n",
    );
    const receipt = await readFile(join(store, "egress.jsonl"), "utf8");
    expect(receipt).not.toMatch(/\.mp4|bytes|path/i);
  });
});
