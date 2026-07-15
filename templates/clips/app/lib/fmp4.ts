/**
 * Fragmented-MP4 helpers for the Media Source Extensions player path.
 *
 * The desktop custom recording pipeline live-streams captures as fragmented
 * MP4 (an `ftyp`+`moov` init segment followed by ~1s `moof`/`mdat` fragments,
 * brands `isom iso5 hlsf`). Those files declare no up-front duration
 * (`mvhd duration=0`, no `mehd`), so Chrome's progressive `<video src>`
 * pipeline scans the whole file over the network before firing
 * `loadedmetadata`. We instead drive playback through MSE and supply the
 * duration ourselves. These pure helpers detect that file shape and parse the
 * bits of the init segment MSE needs.
 *
 * Everything here operates on raw bytes so it can be unit-tested without a
 * browser.
 */

/** Read a 4-char ASCII box type at `offset`. */
function readType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

/** Read a big-endian uint32 at `offset`. */
function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

/** Find the first index of an ASCII marker at or after `from`, or -1. */
export function indexOfAscii(
  bytes: Uint8Array,
  marker: string,
  from = 0,
): number {
  const len = marker.length;
  const last = bytes.byteLength - len;
  for (let i = Math.max(0, from); i <= last; i++) {
    let match = true;
    for (let j = 0; j < len; j++) {
      if (bytes[i + j] !== marker.charCodeAt(j)) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

export interface TopLevelBox {
  type: string;
  /** Absolute offset of the box (its size field). */
  start: number;
  /** Total box size in bytes, or 0 when the box runs to the end of input. */
  size: number;
  /** Bytes from `start` to the first byte of box payload. */
  headerSize: number;
}

/**
 * Walk the top-level MP4 boxes contained in `bytes`. Stops when a box header
 * would run past the buffer (i.e. the buffer is a truncated head), returning
 * whatever complete boxes were found.
 */
export function readTopLevelBoxes(bytes: Uint8Array): TopLevelBox[] {
  const boxes: TopLevelBox[] = [];
  let offset = 0;
  const total = bytes.byteLength;

  while (offset + 8 <= total) {
    let size = readU32(bytes, offset);
    let headerSize = 8;
    const type = readType(bytes, offset + 4);

    if (size === 1) {
      // 64-bit largesize. We only need the low 32 bits in practice (recordings
      // never exceed 4GB), and JS bitwise math is 32-bit, so read the low word.
      if (offset + 16 > total) break;
      headerSize = 16;
      size = readU32(bytes, offset + 12);
    } else if (size === 0) {
      // Box extends to end of file.
      boxes.push({ type, start: offset, size: 0, headerSize });
      break;
    }

    if (size < headerSize) break;
    boxes.push({ type, start: offset, size, headerSize });
    offset += size;
  }

  return boxes;
}

export interface ParsedInitSegment {
  /** Length in bytes of the init segment (end of the `moov` box). */
  initLength: number;
  /** `codecs` string for `video/mp4; codecs="..."`. */
  codecs: string;
  hasVideo: boolean;
  hasAudio: boolean;
}

/**
 * Parse the init segment from the head of a fragmented MP4. `bytes` must
 * contain the whole `ftyp`+`moov` prefix (a few hundred KB is always enough —
 * the init segment carries no per-fragment data). Returns null when `moov` is
 * incomplete or no usable video codec was found.
 */
export function parseInitSegment(bytes: Uint8Array): ParsedInitSegment | null {
  const boxes = readTopLevelBoxes(bytes);
  const moov = boxes.find((b) => b.type === "moov");
  if (!moov || moov.size === 0) return null;
  const moovEnd = moov.start + moov.size;
  if (moovEnd > bytes.byteLength) return null; // moov not fully present yet

  const moovRegion = bytes.subarray(moov.start, moovEnd);
  const videoCodec = parseAvcCodec(moovRegion);
  const hasAudio = indexOfAscii(moovRegion, "mp4a") !== -1;
  const hasVideo = Boolean(videoCodec);

  if (!hasVideo && !hasAudio) return null;

  const codecParts: string[] = [];
  if (videoCodec) codecParts.push(videoCodec);
  // Clips fMP4 audio is always AAC-LC 48kHz stereo → mp4a.40.2.
  if (hasAudio) codecParts.push("mp4a.40.2");

  return {
    initLength: moovEnd,
    codecs: codecParts.join(","),
    hasVideo,
    hasAudio,
  };
}

function hex2(value: number): string {
  return value.toString(16).padStart(2, "0");
}

/**
 * Build the `avc1.PPCCLL` codec string from the `avcC` configuration box within
 * `moovRegion` (PP=profile, CC=profile-compatibility, LL=level). Returns null
 * when no `avcC` box is present.
 */
export function parseAvcCodec(moovRegion: Uint8Array): string | null {
  const marker = indexOfAscii(moovRegion, "avcC");
  if (marker === -1) return null;
  // avcC payload: [0] configurationVersion, [1] AVCProfileIndication,
  // [2] profile_compatibility, [3] AVCLevelIndication.
  const config = marker + 4;
  if (config + 4 > moovRegion.byteLength) return null;
  const profile = moovRegion[config + 1];
  const compat = moovRegion[config + 2];
  const level = moovRegion[config + 3];
  return `avc1.${hex2(profile)}${hex2(compat)}${hex2(level)}`;
}

/**
 * Find the byte offset (relative to `bytes`) of the first `moof` box start — the
 * fragment boundary MSE must begin an append at. `bytes` is a chunk fetched at
 * an arbitrary byte position, so this scans for the `moof` type marker and
 * backs up 4 bytes to the box size field. Returns -1 when none is found.
 */
export function findMoofOffset(bytes: Uint8Array): number {
  let from = 0;
  for (;;) {
    const marker = indexOfAscii(bytes, "moof", from);
    if (marker === -1) return -1;
    const boxStart = marker - 4;
    from = marker + 4;
    if (boxStart < 0) continue;

    const size = readU32(bytes, boxStart);
    // A moof box is small; a bogus size means we hit the ASCII "moof" inside
    // mdat payload rather than a real box header.
    if (size < 16 || size > 16 * 1024 * 1024) continue;

    // A real moof always begins with an `mfhd` child box (payload starts at
    // boxStart+8, whose first child type sits at boxStart+12).
    if (boxStart + 16 > bytes.byteLength) continue;
    if (readType(bytes, boxStart + 12) !== "mfhd") continue;

    // ...and is immediately followed by its `mdat`. Require this when the
    // follower is within the buffer; near the tail we accept the validated moof.
    const nextBox = boxStart + size;
    if (
      nextBox + 8 <= bytes.byteLength &&
      readType(bytes, nextBox + 4) !== "mdat"
    ) {
      continue;
    }

    return boxStart;
  }
}

/**
 * True when the head of an MP4 shows the fragmented shape: the `hlsf` brand in
 * `ftyp`, or an `mvex` box inside `moov` (present only in fragmented files).
 * `headBytes` should be the first few KB of the file.
 */
export function isFragmentedMp4Head(headBytes: Uint8Array): boolean {
  if (headBytes.byteLength < 8) return false;
  // Must look like an MP4 at all.
  if (indexOfAscii(headBytes, "ftyp") !== 4) return false;
  if (indexOfAscii(headBytes, "hlsf") !== -1) return true;
  if (indexOfAscii(headBytes, "mvex") !== -1) return true;
  return false;
}

/** Cache detection by URL identity so we sniff each asset only once. */
const detectionCache = new Map<string, Promise<boolean>>();

function detectionKey(url: string): string {
  try {
    const base =
      typeof window === "undefined"
        ? "http://clips.local"
        : window.location.href;
    const parsed = new URL(url, base);
    // Strip volatile auth/cache-bust params so the same asset shares one entry.
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

const SNIFF_BYTES = 4096;

/**
 * Range-fetch the first few KB of an asset and report whether it is a raw
 * fragmented MP4 that needs the MSE path. Cached per asset; resolves false on
 * any network/parse error so callers fall back to the native `<video src>`.
 */
export async function sniffFragmentedMp4(url: string): Promise<boolean> {
  const key = detectionKey(url);
  const cached = detectionCache.get(key);
  if (cached) return cached;

  const promise = (async () => {
    try {
      const res = await fetch(url, {
        headers: { Range: `bytes=0-${SNIFF_BYTES - 1}` },
      });
      if (!res.ok) return false;
      const head = new Uint8Array(await res.arrayBuffer());
      return isFragmentedMp4Head(head);
    } catch {
      return false;
    }
  })();

  detectionCache.set(key, promise);
  // Don't cache a rejected/false-by-error result forever if it was a transient
  // network blip: drop the entry when it resolves false so a later retry can
  // re-sniff, but keep positive detections cached.
  void promise.then((isFrag) => {
    if (!isFrag) detectionCache.delete(key);
  });
  return promise;
}
