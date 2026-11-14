import { spawn } from "node:child_process";

import {
  StereoLevelMeter,
  type StereoChannelLevels,
} from "../../server/lib/meeting-audio-channels.js";
import {
  ffmpegCommand,
  ffmpegInputArgs,
  type AudioExtractionSource,
  type AudioExtractor,
} from "./audio-only-transcription.js";

/** Loudness only needs a coarse signal; 8 kHz keeps the stream small. */
const LEVEL_SAMPLE_RATE = 8_000;
const LEVEL_WINDOW_MS = 100;
/** Six hours of 100 ms windows; anything longer is not a meeting we keep. */
const MAX_WINDOWS = 6 * 60 * 60 * 10;

/**
 * Reads the loudness of each channel of the first audio stream, in 100 ms
 * windows. Streams the decoded PCM instead of holding it.
 */
export async function extractStereoChannelLevels(
  source: AudioExtractionSource,
  timeoutMs: number,
): Promise<StereoChannelLevels> {
  const meter = new StereoLevelMeter(LEVEL_SAMPLE_RATE, LEVEL_WINDOW_MS);
  const args = [
    "-hide_banner",
    "-nostdin",
    ...ffmpegInputArgs(source),
    "-map",
    "0:a:0",
    "-vn",
    "-ac",
    "2",
    "-ar",
    String(LEVEL_SAMPLE_RATE),
    "-f",
    "s16le",
    "pipe:1",
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegCommand(), args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("ffmpeg timed out reading channel levels"));
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (settled) return;
      if (meter.left.length >= MAX_WINDOWS) {
        // Levels for only part of the audio would name the owner on the
        // first hours and not the rest: fail, so no owner naming is applied.
        child.kill("SIGKILL");
        finish(new Error("audio exceeds the supported channel-level window limit"));
        return;
      }
      meter.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-4096);
    });
    child.on("error", (err) => finish(err));
    child.on("close", (code) => {
      if (code === 0) finish();
      else
        finish(
          new Error(
            `ffmpeg exited with code ${code} reading channel levels: ${stderr.slice(-300)}`,
          ),
        );
    });
  });
  return meter.finish();
}

/**
 * Wraps an extractor so a desktop meeting's media also reports its channel
 * levels. Reading them is a bonus: a failure leaves them out and logs it,
 * and the transcript goes ahead without the owner's name.
 */
export function withStereoChannelLevels(
  extractor: AudioExtractor,
  readLevels: (
    source: AudioExtractionSource,
    timeoutMs: number,
  ) => Promise<StereoChannelLevels> = extractStereoChannelLevels,
): AudioExtractor {
  return async (input) => {
    const media = await extractor(input);
    try {
      const channelLevels = await readLevels(input.source, input.timeoutMs);
      return { ...media, channelLevels };
    } catch (err) {
      console.warn(
        "[meeting-audio] could not read the channel levels; the owner's lines stay unnamed:",
        err instanceof Error ? err.message : String(err),
      );
      return { ...media, channelLevels: null };
    }
  };
}
