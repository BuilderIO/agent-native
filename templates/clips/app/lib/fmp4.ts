function readType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

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
  start: number;
  size: number;
  headerSize: number;
}

export function readTopLevelBoxes(bytes: Uint8Array): TopLevelBox[] {
  const boxes: TopLevelBox[] = [];
  let offset = 0;
  const total = bytes.byteLength;

  while (offset + 8 <= total) {
    let size = readU32(bytes, offset);
    let headerSize = 8;
    const type = readType(bytes, offset + 4);

    if (size === 1) {
      if (offset + 16 > total) break;
      headerSize = 16;
      size = readU32(bytes, offset + 12);
    } else if (size === 0) {
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
  initLength: number;
  codecs: string;
  hasVideo: boolean;
  hasAudio: boolean;
  tracks: Mp4Track[];
}

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
  timescale: number;
  kind: string;
}

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
  trackId: number;
  baseMediaDecodeTime: number;
}

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

export function parseInitSegment(bytes: Uint8Array): ParsedInitSegment | null {
  const boxes = readTopLevelBoxes(bytes);
  const moov = boxes.find((b) => b.type === "moov");
  if (!moov || moov.size === 0) return null;
  const moovEnd = moov.start + moov.size;
  if (moovEnd > bytes.byteLength) return null;

  const moovRegion = bytes.subarray(moov.start, moovEnd);
  const videoCodec = parseAvcCodec(moovRegion);
  const hasAudio = indexOfAscii(moovRegion, "mp4a") !== -1;
  const hasVideo = Boolean(videoCodec);

  if (!hasVideo && !hasAudio) return null;

  const codecParts: string[] = [];
  if (videoCodec) codecParts.push(videoCodec);
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

export function parseAvcCodec(moovRegion: Uint8Array): string | null {
  const marker = indexOfAscii(moovRegion, "avcC");
  if (marker === -1) return null;
  const config = marker + 4;
  if (config + 4 > moovRegion.byteLength) return null;
  const profile = moovRegion[config + 1];
  const compat = moovRegion[config + 2];
  const level = moovRegion[config + 3];
  return `avc1.${hex2(profile)}${hex2(compat)}${hex2(level)}`;
}

export function findMoofOffset(bytes: Uint8Array): number {
  let from = 0;
  for (;;) {
    const marker = indexOfAscii(bytes, "moof", from);
    if (marker === -1) return -1;
    const boxStart = marker - 4;
    from = marker + 4;
    if (boxStart < 0) continue;

    const size = readU32(bytes, boxStart);
    if (size < 16 || size > 16 * 1024 * 1024) continue;

    if (boxStart + 16 > bytes.byteLength) continue;
    if (readType(bytes, boxStart + 12) !== "mfhd") continue;

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

export function isFragmentedMp4Head(headBytes: Uint8Array): boolean {
  if (headBytes.byteLength < 8) return false;

  if (indexOfAscii(headBytes, "ftyp") !== 4) return false;

  const ftypSize = readU32(headBytes, 0);
  if (ftypSize < 12) return false;
  const ftypEnd = Math.min(ftypSize, headBytes.byteLength);

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

const detectionCache = new Map<string, Promise<boolean>>();

function detectionKey(url: string): string {
  try {
    const base =
      typeof window === "undefined"
        ? "http://clips.local"
        : window.location.href;
    const parsed = new URL(url, base);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

const SNIFF_BYTES = 4096;

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
  void promise.then((isFrag) => {
    if (!isFrag) detectionCache.delete(key);
  });
  return promise;
}
