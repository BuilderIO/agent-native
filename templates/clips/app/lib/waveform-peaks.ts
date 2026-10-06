export interface WaveformPeaks {
  peaks: number[];
  bucketCount: number;
  durationSec: number;
  sampleRate: number;
}

const DEFAULT_BUCKET_COUNT = 2000;

async function decodeUrl(url: string, ctx: AudioContext): Promise<AudioBuffer> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Failed to fetch audio: ${res.status} ${res.statusText}`);
  }
  const buf = await res.arrayBuffer();
  return await ctx.decodeAudioData(buf);
}

function downsamplePeaks(buffer: AudioBuffer, bucketCount: number): number[] {
  const peaks = new Array<number>(bucketCount * 2).fill(0);
  const totalFrames = buffer.length;
  const bucketSize = Math.max(1, Math.floor(totalFrames / bucketCount));

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
