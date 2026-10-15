import { describe, expect, it } from "vitest";

import {
  describeTranscriptImportError,
  detectTranscriptFormat,
  formatSrt,
  parseTranscriptImport,
} from "./transcript-import.js";

const VTT = `﻿WEBVTT - PR 7419
Kind: captions
Language: en

NOTE written by the narration script

STYLE
::cue { color: yellow }

intro
00:00:00.000 --> 00:00:04.250 align:start position:10%
<v Sarah>This PR fixes three <b>chart</b> bugs &amp; one crash.

00:04.250 --> 00:00:09.000
<c.highlight>First,</c> the axis labels <00:00:05.000>overlapped.
`;

const SRT = `1
00:00:00,000 --> 00:00:04,250
<i>This PR fixes three chart bugs & one crash.</i>

2
00:00:04,250 --> 00:00:09,000
{\\an8}First, the axis labels
overlapped.
`;

describe("detectTranscriptFormat", () => {
  it("recognizes WebVTT, SRT and timestamped text", () => {
    expect(detectTranscriptFormat(VTT)).toBe("vtt");
    expect(detectTranscriptFormat(SRT)).toBe("srt");
    expect(detectTranscriptFormat("0:00 hello")).toBe("text");
  });

  it("keeps timestamped text with an arrow in its prose as text", () => {
    const text = "0:05 Use a --> b for the flow.\n0:10 Done.";
    expect(detectTranscriptFormat(text)).toBe("text");
    expect(parseTranscriptImport(text)).toMatchObject({
      ok: true,
      segments: [
        { startMs: 5000, endMs: 10_000, text: "Use a --> b for the flow." },
        { startMs: 10_000 },
      ],
    });
  });
});

describe("parseTranscriptImport", () => {
  it("reads WebVTT cues, keeps voice speakers and strips markup", () => {
    const result = parseTranscriptImport(VTT);
    expect(result).toEqual({
      ok: true,
      format: "vtt",
      segments: [
        {
          startMs: 0,
          endMs: 4250,
          text: "This PR fixes three chart bugs & one crash.",
          speaker: "Sarah",
        },
        {
          startMs: 4250,
          endMs: 9000,
          text: "First, the axis labels overlapped.",
        },
      ],
      fullText:
        "This PR fixes three chart bugs & one crash. First, the axis labels overlapped.",
      language: "en",
    });
  });

  it("ends an overlapping cue where the next starts and joins cues that start together", () => {
    const result = parseTranscriptImport(
      [
        "WEBVTT",
        "",
        "00:00.000 --> 00:05.000",
        "<v Ana>One",
        "",
        "00:00.000 --> 00:02.000",
        "<v Ana>two",
        "",
        "00:03.000 --> 00:06.000",
        "<v Ana>three",
        "",
        "00:03.000 --> 00:04.000",
        "<v Ben>four",
      ].join("\n"),
    );
    expect(result).toMatchObject({
      ok: true,
      segments: [
        { startMs: 0, endMs: 3000, text: "One two", speaker: "Ana" },
        { startMs: 3000, endMs: 6000, text: "three four" },
      ],
      language: null,
    });
    if (result.ok) expect(result.segments[1]).not.toHaveProperty("speaker");
  });

  it("reads SRT with the same timings and text as the matching VTT", () => {
    const srt = parseTranscriptImport(SRT);
    const vtt = parseTranscriptImport(VTT);
    if (!srt.ok || !vtt.ok) throw new Error("expected both files to parse");
    expect(srt.format).toBe("srt");
    expect(srt.segments.map(({ speaker: _, ...rest }) => rest)).toEqual(
      vtt.segments.map(({ speaker: _, ...rest }) => rest),
    );
  });

  it("reads a transcript copied from YouTube's transcript panel", () => {
    const copied = [
      "0:00",
      "0 seconds",
      "This PR fixes three chart bugs",
      "0:04",
      "4 seconds",
      "& one crash.",
      "1:02",
      "1 minute, 2 seconds",
      "First, the axis labels overlapped.",
    ].join("\n");
    const result = parseTranscriptImport(copied, { durationMs: 70_000 });
    expect(result).toMatchObject({
      ok: true,
      format: "text",
      segments: [
        { startMs: 0, endMs: 4000, text: "This PR fixes three chart bugs" },
        { startMs: 4000, endMs: 62_000, text: "& one crash." },
        {
          startMs: 62_000,
          endMs: 70_000,
          text: "First, the axis labels overlapped.",
        },
      ],
    });
  });

  it("reads bracketed and Markdown-listed start times on one line", () => {
    const text = [
      "# Walkthrough",
      "",
      "- [0:00] Intro.",
      "**0:21** The chart.",
      "(1:02:03.5) - The end.",
    ].join("\n");
    const result = parseTranscriptImport(text);
    if (!result.ok)
      throw new Error(describeTranscriptImportError(result.error));
    expect(result.segments.map((s) => [s.startMs, s.text])).toEqual([
      [0, "Intro."],
      [21_000, "The chart."],
      [3_723_500, "The end."],
    ]);
    expect(result.segments[2].endMs).toBeGreaterThan(3_723_500);
  });

  it.each([
    [
      "a cue without a timing line",
      "WEBVTT\n\n00:00.000 --> 00:01.000\nok\n\nno timing here\nstill none",
      "missing-timing",
      6,
    ],
    [
      "an unreadable cue timing",
      "1\n00:00:01,000 --> soon\nhello",
      "bad-timing",
      2,
    ],
    [
      "a cue that ends before it starts",
      "1\n00:00:05,000 --> 00:00:01,000\nhello",
      "bad-range",
      2,
    ],
    [
      "text before the first start time",
      "Transcript of my video\n0:00 hello",
      "missing-timestamp",
      1,
    ],
    [
      "a cue timing with 99 minutes past the hour",
      "WEBVTT\n\n00:00:01.000 --> 00:99:00.000\nhello",
      "bad-timing",
      3,
    ],
    [
      "a start time with 90 seconds",
      "0:00 hello\n0:90 world",
      "missing-timestamp",
      2,
    ],
    [
      "a cue timing with more hours than a number can hold",
      `1\n${"9".repeat(400)}:00:00,000 --> 00:00:01,000\nhello`,
      "bad-timing",
      2,
    ],
    [
      "a start time with more hours than a number can hold",
      `0:00 hello\n${"9".repeat(400)}:00:00 world`,
      "missing-timestamp",
      2,
    ],
    [
      "start times that go backwards",
      "0:10 hello\n0:05 world",
      "out-of-order",
      2,
    ],
  ])("names the line for %s", (_, text, code, line) => {
    const result = parseTranscriptImport(text);
    expect(result).toMatchObject({ ok: false, error: { code, line } });
  });

  it("rejects a start time past the end of the video", () => {
    const result = parseTranscriptImport("0:00 hello\n\n5:00 bye", {
      durationMs: 60_000,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "past-end", line: 3 },
    });
    if (result.ok) return;
    expect(describeTranscriptImportError(result.error)).toBe(
      "Line 3: this time is after the end of the video.",
    );
  });

  it("reads NUL and references that are not characters as U+FFFD", () => {
    const FFFD = String.fromCodePoint(0xfffd);
    const result = parseTranscriptImport(
      "WEBVTT\n\n00:00.000 --> 00:01.000\nCaf&#xe9; a\0b &#0; &#xD800; &#x110000;",
    );
    expect(result).toMatchObject({
      ok: true,
      segments: [{ text: `Café a${FFFD}b ${FFFD} ${FFFD} ${FFFD}` }],
    });
  });

  it("reads a cue written straight under the WEBVTT header", () => {
    const result = parseTranscriptImport(
      "WEBVTT\nLanguage: fr\n00:00.000 --> 00:01.000\nBonjour\n\n00:01.000 --> 00:02.000\nSalut",
    );
    expect(result).toMatchObject({
      ok: true,
      segments: [
        { startMs: 0, endMs: 1000, text: "Bonjour" },
        { startMs: 1000, endMs: 2000, text: "Salut" },
      ],
      language: "fr",
    });
  });

  it("rejects a file with no transcript text", () => {
    expect(parseTranscriptImport("WEBVTT\n\n")).toMatchObject({
      ok: false,
      error: { code: "empty", line: null },
    });
  });

  it("round-trips an exported SRT to the same segments", () => {
    const imported = parseTranscriptImport(VTT);
    if (!imported.ok) throw new Error("expected the VTT to parse");
    const reimported = parseTranscriptImport(formatSrt(imported.segments));
    if (!reimported.ok) throw new Error("expected the SRT to parse");
    expect(reimported.segments).toEqual(
      imported.segments.map(({ speaker: _, ...rest }) => rest),
    );
  });
});
