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
  /** Declared tracks, needed to turn a fragment's `tfdt` into seconds. */
  tracks: Mp4Track[];
}

/** Boxes directly contained in `[start, end)`, with offsets relative to `bytes`. */
function boxesIn(bytes: Uint8Array, start: number, end: number): TopLevelBox[] {
  const clampedEnd = Math.min(end, bytes.byteLength);
  if (start >= clampedEnd) return [];
  return readTopLevelBoxes(bytes.subarray(start, clampedEnd)).map((box) => ({
    ...box,
    start: box.start + start,
  }));
}

export interface Mp4Track {
  trackId: number;
  /** Ticks per second for this track's `tfdt` / `mdhd` timestamps. */
  timescale: number;
  /** `hdlr` handler type: "vide", "soun", or "" when absent. */
  kind: string;
}

/**
 * Read each track's id and timescale from a `moov` box (passed including its
 * own header). A fragment's `tfdt` is in its own track's timescale — Clips
 * recordings carry video at 600 and audio at 48000 — so converting a fragment
 * timestamp to seconds without matching its track id is off by 80x.
 */
export function parseTracks(moovRegion: Uint8Array): Mp4Track[] {
  const moovEnd = moovRegion.byteLength;
  if (moovEnd < 8) return [];

  const tracks: Mp4Track[] = [];
  for (const trak of boxesIn(moovRegion, 8, moovEnd)) {
    if (trak.type !== "trak") continue;
    const trakEnd = trak.size ? trak.start + trak.size : moovEnd;
    const trakChildren = boxesIn(
      moovRegion,
      trak.start + trak.headerSize,
      trakEnd,
    );
    const tkhd = trakChildren.find((b) => b.type === "tkhd");
    const mdia = trakChildren.find((b) => b.type === "mdia");
    if (!tkhd || !mdia) continue;

    // FullBox payloads start with a version byte; version 1 widens the two
    // timestamps that precede the field we want from 4 to 8 bytes each.
    const trackId = readFullBoxU32(moovRegion, tkhd, 8);
    if (trackId === null) continue;

    const mdiaEnd = mdia.size ? mdia.start + mdia.size : moovEnd;
    const mdiaChildren = boxesIn(
      moovRegion,
      mdia.start + mdia.headerSize,
      mdiaEnd,
    );
    const mdhd = mdiaChildren.find((b) => b.type === "mdhd");
    if (!mdhd) continue;
    const timescale = readFullBoxU32(moovRegion, mdhd, 8);
    if (timescale === null || timescale <= 0) continue;

    const hdlr = mdiaChildren.find((b) => b.type === "hdlr");
    let kind = "";
    if (hdlr) {
      const handlerAt = hdlr.start + hdlr.headerSize + 8;
      if (handlerAt + 4 <= moovRegion.byteLength) {
        kind = readType(moovRegion, handlerAt);
      }
    }

    tracks.push({ trackId, timescale, kind });
  }
  return tracks;
}

/**
 * Read a uint32 from a FullBox payload at `afterTimestamps` bytes past the
 * version/flags word, accounting for the version-1 widening of the two
 * timestamp fields that precede it (`tkhd` track_ID, `mdhd` timescale).
 */
function readFullBoxU32(
  bytes: Uint8Array,
  box: TopLevelBox,
  afterTimestamps: number,
): number | null {
  const payload = box.start + box.headerSize;
  if (payload >= bytes.byteLength) return null;
  const version = bytes[payload];
  const widened = version === 1 ? afterTimestamps * 2 : afterTimestamps;
  const at = payload + 4 + widened;
  if (at + 4 > bytes.byteLength) return null;
  return readU32(bytes, at);
}

export interface FragmentDecodeTime {
  /** Track the timestamp belongs to; resolve its timescale via `parseTracks`. */
  trackId: number;
  baseMediaDecodeTime: number;
}

/**
 * Read the first track fragment's decode time from the `moof` box at
 * `moofStart`. This is what makes a byte offset locatable on the timeline: it
 * answers "what presentation time does the fragment at this byte position
 * start at", which a byte-fraction estimate can only guess at.
 *
 * Returns null when the `moof` is truncated or carries no `tfdt`.
 */
export function readFragmentDecodeTime(
  bytes: Uint8Array,
  moofStart: number,
): FragmentDecodeTime | null {
  if (moofStart < 0 || moofStart + 8 > bytes.byteLength) return null;
  const size = readU32(bytes, moofStart);
  if (size < 16) return null;
  const moofEnd = Math.min(moofStart + size, bytes.byteLength);

  for (const traf of boxesIn(bytes, moofStart + 8, moofEnd)) {
    if (traf.type !== "traf") continue;
    const trafEnd = traf.size ? traf.start + traf.size : moofEnd;
    let trackId: number | null = null;
    let baseMediaDecodeTime: number | null = null;

    for (const child of boxesIn(bytes, traf.start + traf.headerSize, trafEnd)) {
      const payload = child.start + child.headerSize;
      if (child.type === "tfhd") {
        if (payload + 8 <= bytes.byteLength) {
          trackId = readU32(bytes, payload + 4);
        }
      } else if (child.type === "tfdt") {
        if (payload >= bytes.byteLength) continue;
        if (bytes[payload] === 1) {
          if (payload + 12 > bytes.byteLength) continue;
          // 64-bit: JS numbers hold this exactly for any real recording length.
          baseMediaDecodeTime =
            readU32(bytes, payload + 4) * 4294967296 +
            readU32(bytes, payload + 8);
        } else {
          if (payload + 8 > bytes.byteLength) continue;
          baseMediaDecodeTime = readU32(bytes, payload + 4);
        }
      }
    }

    if (trackId !== null && baseMediaDecodeTime !== null) {
      return { trackId, baseMediaDecodeTime };
    }
  }
  return null;
}

/**
 * Presentation time in seconds of the fragment whose `moof` starts at
 * `moofStart`, or null when it cannot be read (truncated box, or a track id
 * absent from `tracks`). Never falls back to a different track's timescale — a
 * wrong timescale is worse than no answer, because callers use this to decide
 * where to start appending.
 */
export function fragmentPtsSeconds(
  bytes: Uint8Array,
  moofStart: number,
  tracks: readonly Mp4Track[],
): number | null {
  const decodeTime = readFragmentDecodeTime(bytes, moofStart);
  if (!decodeTime) return null;
  const track = tracks.find((t) => t.trackId === decodeTime.trackId);
  if (!track || track.timescale <= 0) return null;
  return decodeTime.baseMediaDecodeTime / track.timescale;
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
    tracks: parseTracks(moovRegion),
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
 *
 * Both checks walk the ISO BMFF box structure rather than scanning raw bytes.
 * Numeric fields inside moov children (timestamps, matrix values, codec config)
 * can accidentally contain the byte sequences "mvex" or "hlsf", producing false
 * positives if we just scan the whole buffer.
 */
export function isFragmentedMp4Head(headBytes: Uint8Array): boolean {
  if (headBytes.byteLength < 8) return false;

  if (indexOfAscii(headBytes, "ftyp") !== 4) return false;

  const ftypSize = readU32(headBytes, 0);
  if (ftypSize < 12) return false;
  const ftypEnd = Math.min(ftypSize, headBytes.byteLength);

  // Offset 12 is minor_version (uint32), not a brand — start compatible brands at 16.
  if (ftypEnd >= 12 && readType(headBytes, 8) === "hlsf") return true;
  for (let i = 16; i + 4 <= ftypEnd; i += 4) {
    if (readType(headBytes, i) === "hlsf") return true;
  }

  const boxes = readTopLevelBoxes(headBytes);
  const moov = boxes.find((b) => b.type === "moov");
  if (!moov || moov.size === 0) return false;
  const moovPayloadEnd = Math.min(moov.start + moov.size, headBytes.byteLength);
  const moovPayload = headBytes.subarray(
    moov.start + moov.headerSize,
    moovPayloadEnd,
  );
  return readTopLevelBoxes(moovPayload).some((b) => b.type === "mvex");
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
