import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildConcatList,
  buildCopyConcatArgs,
  buildReencodeArgs,
  concatVideoFiles,
  parseFfprobeOutput,
  parseSourceRecordingIds,
  planStitch,
  probeStitchSource,
  stitchFfmpegTimeoutMs,
  type StitchSourceProbe,
} from "./stitch-job.js";

function mp4(overrides: Partial<StitchSourceProbe> = {}): StitchSourceProbe {
  return {
    formatName: "mov,mp4,m4a,3gp,3g2,mj2",
    durationMs: 10_000,
    video: {
      codec: "h264",
      profile: "High",
      width: 1920,
      height: 1080,
      pixFmt: "yuv420p",
    },
    audio: { codec: "aac", sampleRate: 48_000, channels: 2 },
    ...overrides,
  };
}

describe("parseFfprobeOutput", () => {
  it("reads the format, first video and first audio stream", () => {
    const probe = parseFfprobeOutput({
      format: { format_name: "matroska,webm", duration: "12.345" },
      streams: [
        {
          codec_type: "video",
          codec_name: "vp9",
          profile: "Profile 0",
          width: 1280,
          height: 720,
          pix_fmt: "yuv420p",
          start_time: "0.000000",
        },
        {
          codec_type: "audio",
          codec_name: "opus",
          sample_rate: "48000",
          channels: 2,
          start_time: "0.480000",
        },
      ],
    });
    expect(probe).toEqual({
      formatName: "matroska,webm",
      durationMs: 12_345,
      video: {
        codec: "vp9",
        profile: "Profile 0",
        width: 1280,
        height: 720,
        pixFmt: "yuv420p",
        startMs: 0,
      },
      audio: {
        codec: "opus",
        sampleRate: 48_000,
        channels: 2,
        startMs: 480,
      },
    });
  });

  it("treats a missing start time as unknown", () => {
    const probe = parseFfprobeOutput({
      format: { format_name: "matroska,webm" },
      streams: [
        {
          codec_type: "video",
          codec_name: "vp8",
          width: 640,
          height: 480,
          start_time: "N/A",
        },
      ],
    });
    expect(probe.video?.startMs).toBeNull();
  });

  it("handles a webm without duration and without audio", () => {
    const probe = parseFfprobeOutput({
      format: { format_name: "matroska,webm", duration: "N/A" },
      streams: [
        { codec_type: "video", codec_name: "vp8", width: 640, height: 480 },
      ],
    });
    expect(probe.durationMs).toBeNull();
    expect(probe.audio).toBeNull();
    expect(probe.video?.codec).toBe("vp8");
  });

  it("ignores cover art when looking for the video track", () => {
    const probe = parseFfprobeOutput({
      format: { format_name: "mov,mp4" },
      streams: [
        {
          codec_type: "video",
          codec_name: "mjpeg",
          width: 300,
          height: 300,
          disposition: { attached_pic: 1 },
        },
      ],
    });
    expect(probe.video).toBeNull();
  });
});

describe("planStitch", () => {
  it("copies when every stream matches", () => {
    expect(planStitch([mp4(), mp4({ durationMs: 5_000 })])).toMatchObject({
      mode: "copy",
      width: 1920,
      height: 1080,
      hasAudio: true,
    });
  });

  it("copies matching sources that have no audio at all", () => {
    expect(
      planStitch([mp4({ audio: null }), mp4({ audio: null })]),
    ).toMatchObject({ mode: "copy", hasAudio: false });
  });

  it("re-encodes to the largest size when sizes differ", () => {
    const plan = planStitch([
      mp4(),
      mp4({
        video: {
          codec: "h264",
          profile: "High",
          width: 1281,
          height: 2000,
          pixFmt: "yuv420p",
        },
      }),
    ]);
    expect(plan).toMatchObject({
      mode: "reencode",
      width: 1920,
      height: 2000,
      audio: "all",
    });
  });

  it("rounds the target size up to even numbers", () => {
    const plan = planStitch([
      mp4({ formatName: "matroska,webm" }),
      mp4({
        video: {
          codec: "h264",
          profile: "High",
          width: 1001,
          height: 333,
          pixFmt: "yuv420p",
        },
      }),
    ]);
    expect(plan.width).toBe(1920);
    expect(
      planStitch([
        mp4({
          video: {
            codec: "h264",
            profile: null,
            width: 1001,
            height: 333,
            pixFmt: null,
          },
        }),
        mp4({
          video: {
            codec: "h264",
            profile: null,
            width: 999,
            height: 331,
            pixFmt: null,
          },
        }),
      ]),
    ).toMatchObject({ width: 1002, height: 334 });
  });

  it("re-encodes webm sources even when they match", () => {
    const webm = mp4({
      formatName: "matroska,webm",
      video: {
        codec: "vp9",
        profile: null,
        width: 1920,
        height: 1080,
        pixFmt: "yuv420p",
      },
      audio: { codec: "opus", sampleRate: 48_000, channels: 2 },
    });
    expect(planStitch([webm, webm]).mode).toBe("reencode");
  });

  it("re-encodes when the audio differs", () => {
    expect(
      planStitch([
        mp4(),
        mp4({ audio: { codec: "aac", sampleRate: 44_100, channels: 2 } }),
      ]).mode,
    ).toBe("reencode");
    expect(
      planStitch([
        mp4(),
        mp4({ audio: { codec: "aac", sampleRate: 48_000, channels: 1 } }),
      ]).mode,
    ).toBe("reencode");
  });

  it("re-encodes with silence when only some sources have audio", () => {
    expect(planStitch([mp4(), mp4({ audio: null })])).toMatchObject({
      mode: "reencode",
      audio: "some",
    });
  });

  it("re-encodes when the pixel format or profile differs", () => {
    expect(
      planStitch([
        mp4(),
        mp4({
          video: {
            codec: "h264",
            profile: "High",
            width: 1920,
            height: 1080,
            pixFmt: "yuv444p",
          },
        }),
      ]).mode,
    ).toBe("reencode");
    expect(
      planStitch([
        mp4(),
        mp4({
          video: {
            codec: "h264",
            profile: "Main",
            width: 1920,
            height: 1080,
            pixFmt: "yuv420p",
          },
        }),
      ]).mode,
    ).toBe("reencode");
  });

  it("refuses a source without video and fewer than two sources", () => {
    expect(() => planStitch([mp4(), mp4({ video: null })])).toThrow(
      /Recording 2/,
    );
    expect(() => planStitch([mp4()])).toThrow(/at least 2/);
  });
});

describe("ffmpeg arguments", () => {
  it("builds a concat list that survives quotes in paths", () => {
    expect(buildConcatList(["/tmp/a.mp4", "/tmp/it's.mp4"])).toBe(
      "ffconcat version 1.0\nfile '/tmp/a.mp4'\nfile '/tmp/it'\\''s.mp4'\n",
    );
  });

  it("copies with the concat demuxer and faststart", () => {
    const args = buildCopyConcatArgs({
      listPath: "/tmp/list.txt",
      outputPath: "/tmp/out.mp4",
      hasAudio: true,
    });
    expect(args[0]).toBe("-hide_banner");
    expect(args.join(" ")).toContain(
      "-f concat -safe 0 -i /tmp/list.txt -map 0:v:0 -map 0:a:0 -c copy -movflags +faststart -f mp4 /tmp/out.mp4",
    );
    expect(
      buildCopyConcatArgs({
        listPath: "/tmp/list.txt",
        outputPath: "/tmp/out.mp4",
        hasAudio: false,
      }),
    ).not.toContain("0:a:0");
  });

  it("re-encodes with scale/pad, silence for missing audio and 4 threads", () => {
    const args = buildReencodeArgs({
      inputs: [
        { path: "/tmp/a.webm", hasAudio: true, durationMs: 1_500 },
        { path: "/tmp/b.mp4", hasAudio: false, durationMs: 2_250 },
      ],
      width: 1920,
      height: 1080,
      audio: "some",
      outputPath: "/tmp/out.mp4",
    });
    expect(args[0]).toBe("-hide_banner");
    const joined = args.join(" ");
    expect(joined).toContain("-i /tmp/a.webm -i /tmp/b.mp4");
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain(
      "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1",
    );
    expect(graph).toContain("[0:a]aresample=48000");
    expect(graph).toContain(
      "anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=2.250",
    );
    expect(graph).toContain("[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]");
    expect(joined).toContain(
      "-c:v libx264 -preset veryfast -crf 22 -pix_fmt yuv420p -c:a aac -b:a 128k -threads 4",
    );
    expect(joined).toContain("-movflags +faststart -f mp4 /tmp/out.mp4");
  });

  it("keeps audio that starts later than its video in sync (regression)", () => {
    const args = buildReencodeArgs({
      inputs: [
        {
          path: "/tmp/late.mkv",
          hasAudio: true,
          durationMs: 2_000,
          videoStartMs: 0,
          audioStartMs: 500,
        },
        {
          path: "/tmp/early.mkv",
          hasAudio: true,
          durationMs: 2_000,
          videoStartMs: 400,
          audioStartMs: 0,
        },
        {
          path: "/tmp/aligned.mp4",
          hasAudio: true,
          durationMs: 2_000,
          videoStartMs: 0,
          audioStartMs: 0,
        },
      ],
      width: 640,
      height: 360,
      audio: "all",
      outputPath: "/tmp/out.mp4",
    });
    const graph = args[args.indexOf("-filter_complex") + 1];
    // Video is reset to 0 per segment; audio that started 0.5s after the
    // video is delayed by the same 0.5s instead of being pulled to 0.
    expect(graph).toContain(
      "[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS,adelay=delays=500|500[a0]",
    );
    // Audio that started 0.4s before the video loses that lead-in.
    expect(graph).toContain(
      "[1:a]atrim=start=0.400,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a1]",
    );
    expect(graph).toContain(
      "[2:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a2]",
    );
    expect(graph).toContain("[1:v]scale=640:360");
    expect(graph).toContain("setpts=PTS-STARTPTS[v1]");
  });

  it("drops audio entirely when no source has any", () => {
    const args = buildReencodeArgs({
      inputs: [
        { path: "/tmp/a.webm", hasAudio: false, durationMs: null },
        { path: "/tmp/b.webm", hasAudio: false, durationMs: null },
      ],
      width: 640,
      height: 480,
      audio: "none",
      outputPath: "/tmp/out.mp4",
    });
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("[v0][v1]concat=n=2:v=1:a=0[outv]");
    expect(graph).not.toContain("anullsrc");
    expect(args).not.toContain("[outa]");
    expect(args).not.toContain("-c:a");
  });

  it("allows long stitches enough time", () => {
    expect(stitchFfmpegTimeoutMs(60_000)).toBe(30 * 60 * 1000);
    expect(stitchFfmpegTimeoutMs(23 * 60 * 1000)).toBe(69 * 60 * 1000);
    expect(stitchFfmpegTimeoutMs(10 * 60 * 60 * 1000)).toBe(4 * 60 * 60 * 1000);
  });
});

describe("parseSourceRecordingIds", () => {
  it("accepts arrays, JSON strings and comma lists", () => {
    expect(parseSourceRecordingIds(["a", "", "b"])).toEqual(["a", "b"]);
    expect(parseSourceRecordingIds('["a","b"]')).toEqual(["a", "b"]);
    expect(parseSourceRecordingIds("a, b")).toEqual(["a", "b"]);
  });
});

const hasFfmpeg =
  spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;

function makeClip(
  path: string,
  options: { width: number; height: number; seconds: number; audio: boolean },
): void {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc=size=${options.width}x${options.height}:rate=30:duration=${options.seconds}`,
    ...(options.audio
      ? [
          "-f",
          "lavfi",
          "-i",
          `sine=frequency=440:sample_rate=48000:duration=${options.seconds}`,
          "-ac",
          "2",
        ]
      : []),
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    ...(options.audio ? ["-c:a", "aac"] : []),
    path,
  ];
  const result = spawnSync("ffmpeg", args, { stdio: "pipe" });
  if (result.status !== 0) {
    throw new Error(`could not make test clip: ${result.stderr.toString()}`);
  }
}

// oracle-change: runs only where the ffmpeg binary exists; CI hosts without it cannot run these real-ffmpeg cases
describe.skipIf(!hasFfmpeg)("concatVideoFiles with real ffmpeg", () => {
  it("stream-copies matching mp4 clips", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stitch-test-"));
    try {
      const a = join(dir, "a.mp4");
      const b = join(dir, "b.mp4");
      makeClip(a, { width: 320, height: 240, seconds: 2, audio: true });
      makeClip(b, { width: 320, height: 240, seconds: 3, audio: true });
      const out = join(dir, "out.mp4");
      const result = await concatVideoFiles([{ path: a }, { path: b }], out);
      expect(result.plan.mode).toBe("copy");
      expect(result.mode).toBe("copy");
      expect(result.width).toBe(320);
      expect(result.height).toBe(240);
      expect(result.hasAudio).toBe(true);
      expect(Math.abs(result.durationMs - 5_000)).toBeLessThan(300);
      expect(result.sizeBytes).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("re-encodes clips of different sizes, one without audio", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stitch-test-"));
    try {
      const a = join(dir, "a.mp4");
      const b = join(dir, "b.webm");
      makeClip(a, { width: 320, height: 240, seconds: 2, audio: true });
      // A webm without audio, as an older recording might be.
      const webm = spawnSync(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "testsrc=size=640x360:rate=30:duration=3",
          "-c:v",
          "libvpx",
          "-deadline",
          "realtime",
          "-b:v",
          "500k",
          b,
        ],
        { stdio: "pipe" },
      );
      expect(webm.status, webm.stderr.toString()).toBe(0);
      const out = join(dir, "out.mp4");
      const result = await concatVideoFiles([{ path: a }, { path: b }], out);
      expect(result.plan).toMatchObject({ mode: "reencode", audio: "some" });
      expect(result.mode).toBe("reencode");
      expect(result.width).toBe(640);
      expect(result.height).toBe(360);
      expect(result.hasAudio).toBe(true);
      expect(Math.abs(result.durationMs - 5_000)).toBeLessThan(400);
      const probe = await probeStitchSource(out);
      expect(probe.video?.codec).toBe("h264");
      expect(probe.audio?.codec).toBe("aac");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("keeps offset audio in sync when re-encoding (regression)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stitch-test-"));
    try {
      // 2s of video whose audio, a 1s tone, starts 0.5s after the video.
      const late = join(dir, "late.mkv");
      makeOffsetAudioClip(late, { width: 320, height: 240, audioDelay: 0.5 });
      // A second clip of another size, so the stitch has to re-encode.
      const b = join(dir, "b.mp4");
      makeClip(b, { width: 640, height: 360, seconds: 2, audio: false });
      const probe = await probeStitchSource(late);
      expect(probe.audio?.startMs).toBe(500);
      expect(probe.video?.startMs).toBe(0);

      const out = join(dir, "out.mp4");
      const result = await concatVideoFiles([{ path: late }, { path: b }], out);
      expect(result.mode).toBe("reencode");

      // The tone must still sound from 0.5s to 1.5s. Resetting the audio to
      // its own start would move it to 0s-1s.
      const sound = soundingSpans(out);
      expect(sound.length).toBeGreaterThan(0);
      expect(Math.abs((sound[0]?.start ?? -1) - 0.5)).toBeLessThan(0.08);
      expect(Math.abs((sound[0]?.end ?? -1) - 1.5)).toBeLessThan(0.08);
      // The silent second clip still starts at 2s: its audio is the padding.
      expect(Math.abs(result.durationMs - 4_000)).toBeLessThan(150);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

// oracle-change: runs only where the ffmpeg binary exists; CI hosts without it cannot run these real-ffmpeg cases
describe.skipIf(!hasFfmpeg)(
  "re-encode silence padding with real ffmpeg",
  () => {
    it("pads a silent source of unknown duration to its video length", async () => {
      const dir = await mkdtemp(join(tmpdir(), "stitch-test-"));
      try {
        const silent = join(dir, "silent.mp4");
        const tone = join(dir, "tone.mp4");
        makeClip(silent, { width: 320, height: 240, seconds: 2, audio: false });
        makeClip(tone, { width: 320, height: 240, seconds: 2, audio: true });
        const out = join(dir, "out.mp4");
        const run = spawnSync(
          "ffmpeg",
          buildReencodeArgs({
            inputs: [
              // No duration known: only 0.1s of silence is generated, and the
              // concat filter pads it to the end of the segment's video.
              { path: silent, hasAudio: false, durationMs: null },
              { path: tone, hasAudio: true, durationMs: 2_000 },
            ],
            width: 320,
            height: 240,
            audio: "some",
            outputPath: out,
          }),
          { stdio: "pipe" },
        );
        expect(run.status, run.stderr.toString()).toBe(0);
        const sound = soundingSpans(out);
        expect(Math.abs((sound[0]?.start ?? -1) - 2)).toBeLessThan(0.08);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }, 60_000);
  },
);

/** A 2s clip whose 1s tone starts `audioDelay` seconds after the video. */
function makeOffsetAudioClip(
  path: string,
  options: { width: number; height: number; audioDelay: number },
): void {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc=size=${options.width}x${options.height}:rate=30:duration=2`,
      "-itsoffset",
      String(options.audioDelay),
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=1",
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-ac",
      "2",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "pcm_s16le",
      path,
    ],
    { stdio: "pipe" },
  );
  if (result.status !== 0) {
    throw new Error(`could not make offset clip: ${result.stderr.toString()}`);
  }
}

/** Spans of a file's audio that are not silent, from silencedetect. */
function soundingSpans(path: string): Array<{ start: number; end: number }> {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-i",
      path,
      "-map",
      "0:a:0",
      "-af",
      "silencedetect=noise=-40dB:d=0.1",
      "-f",
      "null",
      "-",
    ],
    { stdio: "pipe" },
  );
  const log = result.stderr.toString();
  const starts = [...log.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) =>
    Number(m[1]),
  );
  const ends = [...log.matchAll(/silence_end: (-?[\d.]+)/g)].map((m) =>
    Number(m[1]),
  );
  // Sound runs from the start (unless it opens silent) and from each
  // silence_end to the next silence_start.
  const firstSilence = starts[0] ?? Infinity;
  const opensSounding =
    firstSilence > 0.01 && firstSilence < (ends[0] ?? Infinity);
  const soundStarts = [...(opensSounding ? [0] : []), ...ends];
  // Sound that runs to the end of the file has no closing silence_start.
  return soundStarts.map((start) => ({
    start,
    end: starts.find((silence) => silence > start) ?? Infinity,
  }));
}
