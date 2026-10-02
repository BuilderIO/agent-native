import { describe, expect, it } from "vitest";

import { parseAudioChunkList } from "./audio-chunk-list";

describe("parseAudioChunkList", () => {
  it("reads file names and start/end times in seconds", () => {
    expect(
      parseAudioChunkList(
        "chunk-0000.m4a,0.000000,480.010000\nchunk-0001.m4a,480.010000,500.500000\n",
      ),
    ).toEqual([
      { file: "chunk-0000.m4a", startMs: 0, durationMs: 480_010 },
      { file: "chunk-0001.m4a", startMs: 480_010, durationMs: 20_490 },
    ]);
  });

  it("accepts CRLF line endings", () => {
    expect(parseAudioChunkList("a.m4a,0,1\r\nb.m4a,1,2\r\n")).toHaveLength(2);
  });

  it("rejects unreadable or empty-length entries", () => {
    expect(() => parseAudioChunkList("chunk-0000.m4a,abc,1")).toThrow(
      /Unreadable audio chunk list entry/,
    );
    expect(() => parseAudioChunkList("chunk-0000.m4a,5,5")).toThrow(
      /Unreadable audio chunk list entry/,
    );
  });
});
