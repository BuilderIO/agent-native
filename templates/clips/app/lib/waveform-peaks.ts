/**
 * Client-side waveform peak computation.
 *
 * Given a video URL we decode the audio track into peaks (one pair of min/max
 * samples per "bucket") using the Web Audio API. The default bucket count is
 * 2000, which gives us a decently-detailed waveform without being slow to draw.
 *
 * Results are small enough to cache in `application_state` keyed by
 * `waveform-<recordingId>` — no need to recompute on remount.
 */

export interface WaveformPeaks {
  /** Interleaved [min, max, min, max, ...] pairs, one per bucket. Range -1..1. */
  peaks: number[];
  /** Number of min/max pairs. peaks.length === bucketCount * 2. */
  bucketCount: number;
  /** Duration in seconds of the decoded audio. */
  durationSec: number;
  /** Sample rate of the decoded audio. */
  sampleRate: number;
}

const DEFAULT_BUCKET_COUNT = 2000;

/**
 * Fetch a URL and decode to an AudioBuffer. Browsers will happily decode a
 * video file's audio track as long as the codec is supported (WebM/Opus,
 * MP4/AAC are both fine).
 */
async function decodeUrl(url: string, ctx: AudioContext): Promise<AudioBuffer> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to fetch audio: ${res.status} ${res.statusText}`);
  }
  const buf = await res.arrayBuffer();
  return await ctx.decodeAudioData(buf);
}

/**
 * Downsample an AudioBuffer to a min/max pair per bucket. We always take the
 * max-abs across channels so mono and stereo peaks look visually consistent.
 */
function downsamplePeaks(buffer: AudioBuffer, bucketCount: number): number[] {
  const peaks = new Array<number>(bucketCount * 2).fill(0);
  const totalFrames = buffer.length;
  const bucketSize = Math.max(1, Math.floor(totalFrames / bucketCount));

  // Extract channel data once — array access inside tight loop is much faster
  // than calling getChannelData per sample.
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  for (let b = 0; b < bucketCount; b++) {
    const start = b * bucketSize;
    const end = Math.min(totalFrames, start + bucketSize);
    let min = 0;
    let max = 0;
    for (let i = start; i < end; i++) {
      for (let c = 0; c < channels.length; c++) {
        const v = channels[c][i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    peaks[b * 2] = min;
    peaks[b * 2 + 1] = max;
  }

  return peaks;
}

/**
 * Compute peaks from a given URL. Returns null when the browser can't decode
 * (e.g., no Web Audio support, CORS blocks, or the codec isn't supported).
 */
export async function computePeaks(
  url: string,
  bucketCount: number = DEFAULT_BUCKET_COUNT,
): Promise<WaveformPeaks | null> {
  if (typeof window === "undefined") return null;
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return null;

  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioCtx();
    const audioBuffer = await decodeUrl(url, ctx);
    const peaks = downsamplePeaks(audioBuffer, bucketCount);
    return {
      peaks,
      bucketCount,
      durationSec: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
    };
  } catch (err) {
    console.warn("computePeaks: failed to decode audio", err);
    return null;
  } finally {
    try {
      await ctx?.close();
    } catch {
      // noop
    }
  }
}

/**
 * Compute peaks from a Blob (e.g., a freshly-recorded MediaRecorder chunk
 * before it's been uploaded). Same return shape as `computePeaks`.
 */
export async function computePeaksFromBlob(
  blob: Blob,
  bucketCount: number = DEFAULT_BUCKET_COUNT,
): Promise<WaveformPeaks | null> {
  if (typeof window === "undefined") return null;
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return null;

  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioCtx();
    const buf = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(buf);
    const peaks = downsamplePeaks(audioBuffer, bucketCount);
    return {
      peaks,
      bucketCount,
      durationSec: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
    };
  } catch (err) {
    console.warn("computePeaksFromBlob: failed to decode audio", err);
    return null;
  } finally {
    try {
      await ctx?.close();
    } catch {
      // noop
    }
  }
}
