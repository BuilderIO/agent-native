import path from "path";

import { deleteUploadedFile, uploadFile } from "@agent-native/core/file-upload";
import {
  getRequestOrgId,
  runWithRequestContext,
} from "@agent-native/core/server";
import { parseBase64DataUrl } from "@agent-native/core/shared";
import { and, desc, eq, isNull, notLike, or } from "drizzle-orm";
import {
  assertBodySize,
  defineEventHandler,
  getQuery,
  getRouterParam,
  setResponseStatus,
  readMultipartFormData,
  readRawBody,
} from "h3";
import { nanoid } from "nanoid";

import { getDb, schema } from "../db/index.js";
import {
  deleteOrphanedVideoAssetCleanup,
  listOrphanedVideoAssetCleanups,
  recordOrphanedVideoAssetCleanup,
} from "../lib/chunked-upload-session.js";
import {
  resolveSlidesRequestAuth,
  type SlidesRequestAuthContext,
} from "./request-auth-context.js";

type AuthedSlidesSession = SlidesRequestAuthContext & { email: string };

export const MAX_ASSET_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_VIDEO_ASSET_FILE_SIZE = 50 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
export const MAX_ASSET_REQUEST_SIZE =
  MAX_ASSET_FILE_SIZE + MAX_MULTIPART_OVERHEAD_BYTES;
export const MAX_VIDEO_ASSET_REQUEST_SIZE =
  MAX_VIDEO_ASSET_FILE_SIZE + MAX_MULTIPART_OVERHEAD_BYTES;

async function readBoundedMultipartFormData(
  event: Parameters<typeof assertBodySize>[0],
  limit: number,
) {
  const originalRequest = event.req;
  // Nitro exposes HTTPEvent here, while H3's body readers still require H3Event.
  const h3Event = event as unknown as Parameters<typeof readRawBody>[0];
  const contentType = originalRequest.headers.get("content-type");

  await assertBodySize(event, limit);
  if (
    contentType?.split(";")[0]?.trim().toLowerCase() !== "multipart/form-data"
  ) {
    throw Object.assign(new TypeError("Expected multipart/form-data"), {
      statusCode: 400,
    });
  }
  const body = await readRawBody(h3Event, false);
  if (!body || body.byteLength === 0) return undefined;

  const headers = new Headers();
  if (contentType) headers.set("content-type", contentType);
  // The body limiter wraps the request stream, which breaks Request.formData().
  const multipartEvent = Object.assign(
    Object.create(Object.getPrototypeOf(h3Event)),
    h3Event,
    {
      req: new Request(originalRequest.url, {
        method: originalRequest.method,
        headers,
        body: new Blob([body as Uint8Array<ArrayBuffer>]),
      }),
    },
  ) as typeof h3Event;

  try {
    return await readMultipartFormData(multipartEvent);
  } catch (error) {
    if (
      error instanceof TypeError &&
      error.message === "Failed to parse body as FormData."
    ) {
      throw Object.assign(error, { statusCode: 400 });
    }
    throw error;
  }
}

function multipartUploadError(
  event: Parameters<typeof assertBodySize>[0],
  error: unknown,
  fallbackMessage: string,
) {
  const statusCode = (error as { statusCode?: unknown })?.statusCode;
  const status =
    typeof statusCode === "number" && statusCode >= 400 && statusCode < 600
      ? statusCode
      : 500;
  setResponseStatus(
    event as unknown as Parameters<typeof setResponseStatus>[0],
    status,
  );
  return {
    error:
      status === 413 && error instanceof Error
        ? error.message
        : fallbackMessage,
  };
}

export interface UploadedAsset {
  url: string;
  filename: string;
  type: string;
  size: number;
  provider?: string;
}

export interface UploadedVideoAsset extends UploadedAsset {
  id: string;
}

export interface ListedUploadedAsset {
  id: string;
  url: string;
  filename: string;
  size: number;
  createdAt: string;
}

function imageAssetWorkspaceScope(orgId: string | null | undefined) {
  if (!orgId) return isNull(schema.uploadedAssets.orgId);

  // Legacy assets have no trustworthy workspace provenance, but remain owner scoped.
  return or(
    eq(schema.uploadedAssets.orgId, orgId),
    isNull(schema.uploadedAssets.orgId),
  );
}

async function requireSession(
  event: Parameters<typeof resolveSlidesRequestAuth>[0],
): Promise<{ session: AuthedSlidesSession | null; error: string | null }> {
  const auth = await resolveSlidesRequestAuth(event);
  if (!auth.ok) {
    setResponseStatus(event, auth.statusCode);
    return { session: null, error: auth.error };
  }
  if (!auth.context.email) {
    setResponseStatus(event, 401);
    return { session: null, error: "Unauthorized" };
  }
  return { session: auth.context as AuthedSlidesSession, error: null };
}

function isImageAssetExtension(ext: string): boolean {
  return new Set([
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".avif",
    ".ico",
    ".svg",
  ]).has(ext);
}

function ascii(data: Uint8Array, start: number, end: number): string {
  return Buffer.from(data.subarray(start, end)).toString("ascii");
}

const W3C_SVG_11_DOCTYPE =
  /^<!DOCTYPE\s+svg\s+PUBLIC\s+(["'])-\/\/W3C\/\/DTD SVG 1\.1\/\/EN\1\s+(["'])https?:\/\/www\.w3\.org\/Graphics\/SVG\/1\.1\/DTD\/svg11\.dtd\2\s*>$/i;

export function stripSafeSvgDoctype(data: Uint8Array): Uint8Array | null {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    // coercion-ok: malformed UTF-8 must reject SVG validation.
    return null;
  }

  const declarations = [...source.matchAll(/<!DOCTYPE\b[^>]*>/gi)];
  if (declarations.length === 0) return data;
  if (
    declarations.length !== 1 ||
    !W3C_SVG_11_DOCTYPE.test(declarations[0][0])
  ) {
    return null;
  }

  return new TextEncoder().encode(source.replace(declarations[0][0], ""));
}

interface IsoBox {
  type: string;
  start: number;
  payloadStart: number;
  end: number;
}

interface EbmlElement {
  id: number;
  payloadStart: number;
  end: number;
}

const MAX_MEDIA_CONTAINER_ELEMENTS = 100_000;
const MAX_MEDIA_SAMPLE_ENTRIES = 1_000_000;
const EBML_SEGMENT_ID = 0x18538067;
const EBML_CLUSTER_ID = 0x1f43b675;
const EBML_SEGMENT_LEVEL_IDS = new Set([
  0x114d9b74,
  0x1549a966,
  0x1654ae6b,
  EBML_CLUSTER_ID,
  0x1c53bb6b,
  0x1941a469,
  0x1043a770,
  0x1254c367,
]);
const EBML_NESTED_MASTER_IDS = new Set([
  0xa0, 0x5854, 0x75a1, 0xa6, 0x8e, 0xe8, 0xc8,
]);

function uint32(data: Uint8Array, offset: number): number {
  return (
    data[offset]! * 0x1000000 +
    (data[offset + 1]! << 16) +
    (data[offset + 2]! << 8) +
    data[offset + 3]!
  );
}

function readIsoBoxes(
  data: Uint8Array,
  start: number,
  end: number,
): IsoBox[] | null {
  const boxes: IsoBox[] = [];
  let offset = start;
  while (offset < end) {
    if (boxes.length >= MAX_MEDIA_CONTAINER_ELEMENTS || end - offset < 8)
      return null;
    const size32 = uint32(data, offset);
    const type = ascii(data, offset + 4, offset + 8);
    let headerSize = 8;
    let size = size32;
    if (size32 === 1) {
      if (end - offset < 16 || uint32(data, offset + 8) !== 0) return null;
      size = uint32(data, offset + 12);
      headerSize = 16;
    } else if (size32 === 0) {
      size = end - offset;
    }
    if (size < headerSize || size > end - offset) return null;
    boxes.push({
      type,
      start: offset,
      payloadStart: offset + headerSize,
      end: offset + size,
    });
    offset += size;
  }
  return offset === end ? boxes : null;
}

function singleIsoBox(boxes: IsoBox[], type: string): IsoBox | null {
  const matches = boxes.filter((box) => box.type === type);
  return matches.length === 1 ? matches[0]! : null;
}

interface Mp4SampleSizes {
  count: number;
  at(index: number): number | null;
}

function readMp4SampleSizes(
  data: Uint8Array,
  boxes: IsoBox[],
): Mp4SampleSizes | null {
  const sizeBoxes = boxes.filter(
    (box) => box.type === "stsz" || box.type === "stz2",
  );
  if (sizeBoxes.length !== 1) return null;
  const box = sizeBoxes[0]!;
  const payloadSize = box.end - box.payloadStart;
  if (payloadSize < 12) return null;
  const count = uint32(data, box.payloadStart + 8);
  if (count === 0 || count > MAX_MEDIA_SAMPLE_ENTRIES) return null;

  if (box.type === "stsz") {
    const sampleSize = uint32(data, box.payloadStart + 4);
    if (sampleSize > 0) {
      return payloadSize === 12 ? { count, at: () => sampleSize } : null;
    }
    if (payloadSize !== 12 + count * 4) return null;
    return {
      count,
      at: (index) =>
        index >= 0 && index < count
          ? uint32(data, box.payloadStart + 12 + index * 4)
          : null,
    };
  }

  const fieldSize = data[box.payloadStart + 7]!;
  const tableStart = box.payloadStart + 12;
  const tableSize = Math.ceil((count * fieldSize) / 8);
  if (
    (fieldSize !== 4 && fieldSize !== 8 && fieldSize !== 16) ||
    payloadSize !== 12 + tableSize
  )
    return null;
  return {
    count,
    at: (index) => {
      if (index < 0 || index >= count) return null;
      if (fieldSize === 4) {
        const packed = data[tableStart + Math.floor(index / 2)]!;
        return index % 2 === 0 ? packed >> 4 : packed & 0x0f;
      }
      if (fieldSize === 8) return data[tableStart + index]!;
      const offset = tableStart + index * 2;
      return (data[offset]! << 8) + data[offset + 1]!;
    },
  };
}

function readMp4ChunkOffsets(
  data: Uint8Array,
  boxes: IsoBox[],
): number[] | null {
  const offsetBoxes = boxes.filter(
    (box) => box.type === "stco" || box.type === "co64",
  );
  if (offsetBoxes.length !== 1) return null;
  const box = offsetBoxes[0]!;
  const payloadSize = box.end - box.payloadStart;
  if (payloadSize < 8) return null;
  const count = uint32(data, box.payloadStart + 4);
  const entrySize = box.type === "stco" ? 4 : 8;
  if (
    count === 0 ||
    count > MAX_MEDIA_CONTAINER_ELEMENTS ||
    payloadSize !== 8 + count * entrySize
  )
    return null;
  const offsets: number[] = [];
  for (let index = 0; index < count; index++) {
    const offset = box.payloadStart + 8 + index * entrySize;
    const value =
      entrySize === 4
        ? uint32(data, offset)
        : uint32(data, offset) * 0x100000000 + uint32(data, offset + 4);
    if (!Number.isSafeInteger(value)) return null;
    offsets.push(value);
  }
  return offsets;
}

function isMediaDataRange(
  offset: number,
  size: number,
  mediaDataBoxes: IsoBox[],
): boolean {
  const end = offset + size;
  if (!Number.isSafeInteger(end)) return false;
  let low = 0;
  let high = mediaDataBoxes.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (mediaDataBoxes[middle]!.end <= offset) low = middle + 1;
    else high = middle;
  }
  const box = mediaDataBoxes[low];
  return Boolean(box && offset >= box.payloadStart && end <= box.end);
}

function readMp4TrackId(data: Uint8Array, trackHeader: IsoBox): number | null {
  const version = data[trackHeader.payloadStart];
  const offset = version === 0 ? 12 : version === 1 ? 20 : null;
  const minimumSize = version === 0 ? 84 : version === 1 ? 96 : null;
  if (
    offset === null ||
    minimumSize === null ||
    trackHeader.end - trackHeader.payloadStart < minimumSize
  )
    return null;
  const trackId = uint32(data, trackHeader.payloadStart + offset);
  return trackId > 0 ? trackId : null;
}

function hasValidAvcConfiguration(
  data: Uint8Array,
  sampleDescription: IsoBox,
): boolean {
  if (sampleDescription.type !== "avc1" && sampleDescription.type !== "avc3")
    return true;
  const fixedSampleEntryEnd = sampleDescription.payloadStart + 78;
  if (fixedSampleEntryEnd > sampleDescription.end) return false;
  const childBoxes = readIsoBoxes(
    data,
    fixedSampleEntryEnd,
    sampleDescription.end,
  );
  const configurations = childBoxes?.filter((box) => box.type === "avcC") ?? [];
  if (configurations.length !== 1) return false;
  const configuration = configurations[0]!;
  let offset = configuration.payloadStart;
  if (
    configuration.end - offset < 7 ||
    data[offset] !== 1 ||
    (data[offset + 4]! & 0xfc) !== 0xfc ||
    (data[offset + 4]! & 0x03) === 0x02 ||
    (data[offset + 5]! & 0xe0) !== 0xe0
  )
    return false;

  const sequenceParameterSetCount = data[offset + 5]! & 0x1f;
  if (sequenceParameterSetCount === 0) return false;
  offset += 6;
  for (let index = 0; index < sequenceParameterSetCount; index++) {
    if (offset + 2 > configuration.end) return false;
    const length = (data[offset]! << 8) | data[offset + 1]!;
    offset += 2;
    if (
      length === 0 ||
      offset + length > configuration.end ||
      (data[offset]! & 0x1f) !== 7
    )
      return false;
    offset += length;
  }
  if (offset >= configuration.end) return false;
  const pictureParameterSetCount = data[offset++]!;
  if (pictureParameterSetCount === 0) return false;
  for (let index = 0; index < pictureParameterSetCount; index++) {
    if (offset + 2 > configuration.end) return false;
    const length = (data[offset]! << 8) | data[offset + 1]!;
    offset += 2;
    if (
      length === 0 ||
      offset + length > configuration.end ||
      (data[offset]! & 0x1f) !== 8
    )
      return false;
    offset += length;
  }
  if (offset === configuration.end) return true;

  if (
    configuration.end - offset < 4 ||
    (data[offset]! & 0xfc) !== 0xfc ||
    (data[offset + 1]! & 0xf8) !== 0xf8 ||
    (data[offset + 2]! & 0xf8) !== 0xf8
  )
    return false;
  const sequenceParameterSetExtCount = data[offset + 3]!;
  offset += 4;
  for (let index = 0; index < sequenceParameterSetExtCount; index++) {
    if (offset + 2 > configuration.end) return false;
    const length = (data[offset]! << 8) | data[offset + 1]!;
    offset += 2;
    if (
      length === 0 ||
      offset + length > configuration.end ||
      (data[offset]! & 0x1f) !== 13
    )
      return false;
    offset += length;
  }
  return offset === configuration.end;
}

interface Mp4TrackMetadata {
  trackId: number;
  isVideo: boolean;
  sampleDescriptionCount: number;
  sampleTableBoxes: IsoBox[];
}

function readMp4TrackMetadata(
  data: Uint8Array,
  track: IsoBox,
): Mp4TrackMetadata | null {
  const trackBoxes = readIsoBoxes(data, track.payloadStart, track.end);
  if (!trackBoxes) return null;
  const trackHeader = singleIsoBox(trackBoxes, "tkhd");
  const media = singleIsoBox(trackBoxes, "mdia");
  if (!trackHeader || !media) return null;
  if (fullBoxFlags(data, trackHeader) === null) return null;
  const trackId = readMp4TrackId(data, trackHeader);
  if (!trackId) return null;

  const mediaBoxes = readIsoBoxes(data, media.payloadStart, media.end);
  if (!mediaBoxes) return null;
  const mediaHeader = singleIsoBox(mediaBoxes, "mdhd");
  const handler = singleIsoBox(mediaBoxes, "hdlr");
  const mediaInfo = singleIsoBox(mediaBoxes, "minf");
  if (
    !mediaHeader ||
    (data[mediaHeader.payloadStart] === 0 &&
      mediaHeader.end - mediaHeader.payloadStart < 24) ||
    (data[mediaHeader.payloadStart] === 1 &&
      mediaHeader.end - mediaHeader.payloadStart < 36) ||
    (data[mediaHeader.payloadStart] !== 0 &&
      data[mediaHeader.payloadStart] !== 1) ||
    fullBoxFlags(data, mediaHeader) === null ||
    !handler ||
    handler.end - handler.payloadStart < 24 ||
    !mediaInfo
  )
    return null;
  const isVideo =
    ascii(data, handler.payloadStart + 8, handler.payloadStart + 12) === "vide";

  const mediaInfoBoxes = readIsoBoxes(
    data,
    mediaInfo.payloadStart,
    mediaInfo.end,
  );
  const sampleTable = mediaInfoBoxes
    ? singleIsoBox(mediaInfoBoxes, "stbl")
    : null;
  if (!mediaInfoBoxes || !sampleTable) return null;
  const sampleTableBoxes = readIsoBoxes(
    data,
    sampleTable.payloadStart,
    sampleTable.end,
  );
  const sampleDescription = sampleTableBoxes
    ? singleIsoBox(sampleTableBoxes, "stsd")
    : null;
  if (
    !sampleTableBoxes ||
    !sampleDescription ||
    sampleDescription.end - sampleDescription.payloadStart < 8 ||
    data[sampleDescription.payloadStart] !== 0 ||
    fullBoxFlags(data, sampleDescription) !== 0
  )
    return null;
  const sampleDescriptionCount = uint32(
    data,
    sampleDescription.payloadStart + 4,
  );
  if (
    sampleDescriptionCount === 0 ||
    sampleDescriptionCount > MAX_MEDIA_CONTAINER_ELEMENTS
  )
    return null;
  const sampleDescriptions = readIsoBoxes(
    data,
    sampleDescription.payloadStart + 8,
    sampleDescription.end,
  );
  if (
    !sampleDescriptions ||
    sampleDescriptions.length !== sampleDescriptionCount ||
    sampleDescriptions.some(
      (entry) =>
        entry.end - entry.start < (isVideo ? 86 : 8) ||
        (isVideo && !hasValidAvcConfiguration(data, entry)),
    )
  )
    return null;

  return { trackId, isVideo, sampleDescriptionCount, sampleTableBoxes };
}

function hasEmptyMp4SampleTables(data: Uint8Array, boxes: IsoBox[]): boolean {
  const timing = singleIsoBox(boxes, "stts");
  const sampleToChunk = singleIsoBox(boxes, "stsc");
  const sizeBoxes = boxes.filter(
    (box) => box.type === "stsz" || box.type === "stz2",
  );
  const offsetBoxes = boxes.filter(
    (box) => box.type === "stco" || box.type === "co64",
  );
  if (
    !timing ||
    !sampleToChunk ||
    sizeBoxes.length !== 1 ||
    offsetBoxes.length !== 1
  )
    return false;

  const timingSize = timing.end - timing.payloadStart;
  const mappingSize = sampleToChunk.end - sampleToChunk.payloadStart;
  if (
    timingSize !== 8 ||
    mappingSize !== 8 ||
    data[timing.payloadStart] !== 0 ||
    data[sampleToChunk.payloadStart] !== 0 ||
    fullBoxFlags(data, timing) !== 0 ||
    fullBoxFlags(data, sampleToChunk) !== 0 ||
    uint32(data, timing.payloadStart + 4) !== 0 ||
    uint32(data, sampleToChunk.payloadStart + 4) !== 0
  )
    return false;

  const sampleSizes = sizeBoxes[0]!;
  const sizePayload = sampleSizes.end - sampleSizes.payloadStart;
  if (
    sizePayload !== 12 ||
    data[sampleSizes.payloadStart] !== 0 ||
    fullBoxFlags(data, sampleSizes) !== 0 ||
    uint32(data, sampleSizes.payloadStart + 8) !== 0
  )
    return false;
  if (sampleSizes.type === "stsz") {
    if (uint32(data, sampleSizes.payloadStart + 4) !== 0) return false;
  } else {
    const fieldSize = data[sampleSizes.payloadStart + 7]!;
    if (fieldSize !== 4 && fieldSize !== 8 && fieldSize !== 16) return false;
  }

  const offsets = offsetBoxes[0]!;
  const offsetPayload = offsets.end - offsets.payloadStart;
  return (
    offsetPayload === 8 &&
    data[offsets.payloadStart] === 0 &&
    fullBoxFlags(data, offsets) === 0 &&
    uint32(data, offsets.payloadStart + 4) === 0
  );
}

function hasMp4PlayableSamples(
  data: Uint8Array,
  boxes: IsoBox[],
  sampleDescriptionCount: number,
  mediaDataBoxes: IsoBox[],
): boolean {
  const sampleSizes = readMp4SampleSizes(data, boxes);
  const timing = singleIsoBox(boxes, "stts");
  const sampleToChunk = singleIsoBox(boxes, "stsc");
  const chunkOffsets = readMp4ChunkOffsets(data, boxes);
  if (!sampleSizes || !timing || !sampleToChunk || !chunkOffsets) return false;

  const timingPayloadSize = timing.end - timing.payloadStart;
  if (timingPayloadSize < 8) return false;
  const timingEntryCount = uint32(data, timing.payloadStart + 4);
  if (
    timingEntryCount === 0 ||
    timingEntryCount > MAX_MEDIA_CONTAINER_ELEMENTS ||
    timingPayloadSize !== 8 + timingEntryCount * 8
  )
    return false;
  let timedSampleCount = 0;
  for (let index = 0; index < timingEntryCount; index++) {
    const entryOffset = timing.payloadStart + 8 + index * 8;
    const count = uint32(data, entryOffset);
    const delta = uint32(data, entryOffset + 4);
    if (count === 0 || delta === 0) return false;
    timedSampleCount += count;
    if (
      !Number.isSafeInteger(timedSampleCount) ||
      timedSampleCount > sampleSizes.count
    )
      return false;
  }
  if (timedSampleCount !== sampleSizes.count) return false;

  const mappingPayloadSize = sampleToChunk.end - sampleToChunk.payloadStart;
  if (mappingPayloadSize < 8) return false;
  const mappingEntryCount = uint32(data, sampleToChunk.payloadStart + 4);
  if (
    mappingEntryCount === 0 ||
    mappingEntryCount > MAX_MEDIA_CONTAINER_ELEMENTS ||
    mappingPayloadSize !== 8 + mappingEntryCount * 12
  )
    return false;
  const mappings: Array<{
    firstChunk: number;
    samplesPerChunk: number;
  }> = [];
  for (let index = 0; index < mappingEntryCount; index++) {
    const entryOffset = sampleToChunk.payloadStart + 8 + index * 12;
    const firstChunk = uint32(data, entryOffset);
    const samplesPerChunk = uint32(data, entryOffset + 4);
    const descriptionIndex = uint32(data, entryOffset + 8);
    if (
      firstChunk === 0 ||
      (index === 0
        ? firstChunk !== 1
        : firstChunk <= mappings[index - 1]!.firstChunk) ||
      firstChunk > chunkOffsets.length ||
      samplesPerChunk === 0 ||
      descriptionIndex === 0 ||
      descriptionIndex > sampleDescriptionCount
    )
      return false;
    mappings.push({ firstChunk, samplesPerChunk });
  }

  let sampleIndex = 0;
  let mappingIndex = 0;
  for (let chunkIndex = 1; chunkIndex <= chunkOffsets.length; chunkIndex++) {
    while (
      mappingIndex + 1 < mappings.length &&
      mappings[mappingIndex + 1]!.firstChunk <= chunkIndex
    ) {
      mappingIndex++;
    }
    const mapping = mappings[mappingIndex]!;
    const nextSampleIndex = sampleIndex + mapping.samplesPerChunk;
    if (nextSampleIndex > sampleSizes.count) return false;
    let chunkSize = 0;
    for (; sampleIndex < nextSampleIndex; sampleIndex++) {
      const sampleSize = sampleSizes.at(sampleIndex);
      if (sampleSize === null || sampleSize === 0) return false;
      chunkSize += sampleSize;
      if (!Number.isSafeInteger(chunkSize)) return false;
    }
    const chunkOffset = chunkOffsets[chunkIndex - 1]!;
    if (!isMediaDataRange(chunkOffset, chunkSize, mediaDataBoxes)) return false;
  }
  return sampleIndex === sampleSizes.count;
}

function hasMp4VideoTrack(
  data: Uint8Array,
  moov: IsoBox,
  mediaDataBoxes: IsoBox[],
): boolean {
  const movieBoxes = readIsoBoxes(data, moov.payloadStart, moov.end);
  if (!movieBoxes) return false;
  const movieHeader = movieBoxes.find((box) => box.type === "mvhd");
  if (!movieHeader || movieHeader.end - movieHeader.payloadStart < 20)
    return false;

  return movieBoxes.some((track) => {
    if (track.type !== "trak") return false;
    const trackBoxes = readIsoBoxes(data, track.payloadStart, track.end);
    if (!trackBoxes) return false;
    const trackHeader = trackBoxes.find((box) => box.type === "tkhd");
    const media = trackBoxes.find((box) => box.type === "mdia");
    if (
      !trackHeader ||
      trackHeader.end - trackHeader.payloadStart < 24 ||
      !media
    )
      return false;

    const mediaBoxes = readIsoBoxes(data, media.payloadStart, media.end);
    if (!mediaBoxes) return false;
    const mediaHeader = mediaBoxes.find((box) => box.type === "mdhd");
    const handler = mediaBoxes.find((box) => box.type === "hdlr");
    const mediaInfo = mediaBoxes.find((box) => box.type === "minf");
    if (
      !mediaHeader ||
      mediaHeader.end - mediaHeader.payloadStart < 20 ||
      !handler ||
      handler.end - handler.payloadStart < 12 ||
      ascii(data, handler.payloadStart + 8, handler.payloadStart + 12) !==
        "vide" ||
      !mediaInfo
    )
      return false;

    const mediaInfoBoxes = readIsoBoxes(
      data,
      mediaInfo.payloadStart,
      mediaInfo.end,
    );
    const sampleTable = mediaInfoBoxes?.find((box) => box.type === "stbl");
    if (!sampleTable) return false;
    const sampleTableBoxes = readIsoBoxes(
      data,
      sampleTable.payloadStart,
      sampleTable.end,
    );
    const sampleDescription = sampleTableBoxes
      ? singleIsoBox(sampleTableBoxes, "stsd")
      : null;
    if (
      !sampleDescription ||
      sampleDescription.end - sampleDescription.payloadStart < 8
    )
      return false;
    const entryCount = uint32(data, sampleDescription.payloadStart + 4);
    if (entryCount === 0 || entryCount > MAX_MEDIA_CONTAINER_ELEMENTS)
      return false;
    const entries = readIsoBoxes(
      data,
      sampleDescription.payloadStart + 8,
      sampleDescription.end,
    );
    return Boolean(
      entries?.length === entryCount &&
      entries.every(
        (entry) =>
          entry.end - entry.start >= 86 &&
          hasValidAvcConfiguration(data, entry),
      ) &&
      sampleTableBoxes &&
      hasMp4PlayableSamples(data, sampleTableBoxes, entryCount, mediaDataBoxes),
    );
  });
}

function hasValidMp4Video(data: Uint8Array): boolean {
  if (data.length < 16) return false;
  const boxes = readIsoBoxes(data, 0, data.length);
  if (!boxes) return false;
  const fileType = boxes.find((box) => box.type === "ftyp");
  const movie = boxes.find((box) => box.type === "moov");
  const mediaDataBoxes = boxes.filter(
    (box) => box.type === "mdat" && box.end > box.payloadStart,
  );
  if (
    !fileType ||
    fileType.end - fileType.start < 16 ||
    (fileType.end - fileType.start - 16) % 4 !== 0 ||
    !movie ||
    mediaDataBoxes.length === 0
  )
    return false;
  if (boxes.some((box) => box.type === "moof")) {
    return hasValidFragmentedMp4Video(data, boxes, movie, mediaDataBoxes);
  }
  return hasMp4VideoTrack(data, movie, mediaDataBoxes);
}

interface Mp4TrexDefaults {
  sampleDescriptionIndex: number;
  sampleDuration: number;
  sampleSize: number;
}

interface Mp4Tfhd {
  trackId: number;
  baseDataOffset: number | null;
  sampleDescriptionIndex: number;
  defaultSampleDuration: number;
  defaultSampleSize: number;
  durationIsEmpty: boolean;
}

interface Mp4Trun {
  sampleCount: number;
  dataOffset: number | null;
  sampleBytes: number;
}

function fullBoxFlags(data: Uint8Array, box: IsoBox): number | null {
  if (box.end - box.payloadStart < 4) return null;
  return (
    (data[box.payloadStart + 1]! << 16) |
    (data[box.payloadStart + 2]! << 8) |
    data[box.payloadStart + 3]!
  );
}

function readMp4Uint64(data: Uint8Array, offset: number): number | null {
  const value = uint32(data, offset) * 0x100000000 + uint32(data, offset + 4);
  return Number.isSafeInteger(value) ? value : null;
}

function readMp4TrexDefaults(
  data: Uint8Array,
  movieExtends: IsoBox,
  tracks: Map<number, Mp4TrackMetadata>,
): Map<number, Mp4TrexDefaults> | null {
  const boxes = readIsoBoxes(data, movieExtends.payloadStart, movieExtends.end);
  if (!boxes) return null;
  const trexBoxes = boxes.filter((box) => box.type === "trex");
  if (trexBoxes.length !== tracks.size) return null;
  const defaults = new Map<number, Mp4TrexDefaults>();
  for (const box of trexBoxes) {
    if (
      box.end - box.payloadStart !== 24 ||
      data[box.payloadStart] !== 0 ||
      fullBoxFlags(data, box) !== 0
    )
      return null;
    const trackId = uint32(data, box.payloadStart + 4);
    const sampleDescriptionIndex = uint32(data, box.payloadStart + 8);
    const track = tracks.get(trackId);
    if (
      !track ||
      defaults.has(trackId) ||
      sampleDescriptionIndex === 0 ||
      sampleDescriptionIndex > track.sampleDescriptionCount
    )
      return null;
    defaults.set(trackId, {
      sampleDescriptionIndex,
      sampleDuration: uint32(data, box.payloadStart + 12),
      sampleSize: uint32(data, box.payloadStart + 16),
    });
  }
  return defaults.size === tracks.size ? defaults : null;
}

function readMp4Tfhd(
  data: Uint8Array,
  box: IsoBox,
  moofStart: number,
  defaults: Mp4TrexDefaults,
  track: Mp4TrackMetadata,
): Mp4Tfhd | null {
  const payloadSize = box.end - box.payloadStart;
  const flags = fullBoxFlags(data, box);
  if (payloadSize < 8 || data[box.payloadStart] !== 0 || flags === null)
    return null;
  const allowedFlags =
    0x000001 | 0x000002 | 0x000008 | 0x000010 | 0x000020 | 0x010000 | 0x020000;
  if (
    (flags & ~allowedFlags) !== 0 ||
    ((flags & 0x000001) !== 0 && (flags & 0x020000) !== 0)
  )
    return null;

  const trackId = uint32(data, box.payloadStart + 4);
  if (trackId !== track.trackId) return null;
  let offset = box.payloadStart + 8;
  let baseDataOffset: number | null = null;
  let sampleDescriptionIndex = defaults.sampleDescriptionIndex;
  let defaultSampleDuration = defaults.sampleDuration;
  let defaultSampleSize = defaults.sampleSize;
  if ((flags & 0x000001) !== 0) {
    if (offset + 8 > box.end) return null;
    baseDataOffset = readMp4Uint64(data, offset);
    if (baseDataOffset === null) return null;
    offset += 8;
  } else if ((flags & 0x020000) !== 0) {
    baseDataOffset = moofStart;
  }
  if ((flags & 0x000002) !== 0) {
    if (offset + 4 > box.end) return null;
    sampleDescriptionIndex = uint32(data, offset);
    offset += 4;
  }
  if ((flags & 0x000008) !== 0) {
    if (offset + 4 > box.end) return null;
    defaultSampleDuration = uint32(data, offset);
    offset += 4;
  }
  if ((flags & 0x000010) !== 0) {
    if (offset + 4 > box.end) return null;
    defaultSampleSize = uint32(data, offset);
    offset += 4;
  }
  if ((flags & 0x000020) !== 0) {
    if (offset + 4 > box.end) return null;
    offset += 4;
  }
  if (
    offset !== box.end ||
    sampleDescriptionIndex === 0 ||
    sampleDescriptionIndex > track.sampleDescriptionCount
  )
    return null;
  return {
    trackId,
    baseDataOffset,
    sampleDescriptionIndex,
    defaultSampleDuration,
    defaultSampleSize,
    durationIsEmpty: (flags & 0x010000) !== 0,
  };
}

function readMp4Trun(
  data: Uint8Array,
  box: IsoBox,
  tfhd: Mp4Tfhd,
  maxSampleCount: number,
): Mp4Trun | null {
  const payloadSize = box.end - box.payloadStart;
  const version = data[box.payloadStart];
  const flags = fullBoxFlags(data, box);
  if (payloadSize < 8 || (version !== 0 && version !== 1) || flags === null)
    return null;
  const allowedFlags =
    0x000001 | 0x000004 | 0x000100 | 0x000200 | 0x000400 | 0x000800;
  if (
    (flags & ~allowedFlags) !== 0 ||
    ((flags & 0x000004) !== 0 && (flags & 0x000400) !== 0)
  )
    return null;

  const sampleCount = uint32(data, box.payloadStart + 4);
  if (sampleCount > maxSampleCount) return null;
  let offset = box.payloadStart + 8;
  let dataOffset: number | null = null;
  if ((flags & 0x000001) !== 0) {
    if (offset + 4 > box.end) return null;
    const unsignedOffset = uint32(data, offset);
    dataOffset =
      unsignedOffset >= 0x80000000
        ? unsignedOffset - 0x100000000
        : unsignedOffset;
    offset += 4;
  }
  if ((flags & 0x000004) !== 0) {
    if (offset + 4 > box.end) return null;
    offset += 4;
  }

  const hasDuration = (flags & 0x000100) !== 0;
  const hasSize = (flags & 0x000200) !== 0;
  const hasSampleFlags = (flags & 0x000400) !== 0;
  const hasCompositionOffset = (flags & 0x000800) !== 0;
  const perSampleWidth =
    (hasDuration ? 4 : 0) +
    (hasSize ? 4 : 0) +
    (hasSampleFlags ? 4 : 0) +
    (hasCompositionOffset ? 4 : 0);
  if (offset + sampleCount * perSampleWidth !== box.end) return null;

  let sampleBytes = 0;
  for (let index = 0; index < sampleCount; index++) {
    const duration = hasDuration
      ? uint32(data, offset)
      : tfhd.defaultSampleDuration;
    if (hasDuration) offset += 4;
    const size = hasSize ? uint32(data, offset) : tfhd.defaultSampleSize;
    if (hasSize) offset += 4;
    if (duration === 0 || size === 0) return null;
    sampleBytes += size;
    if (!Number.isSafeInteger(sampleBytes)) return null;
    if (hasSampleFlags) offset += 4;
    if (hasCompositionOffset) offset += 4;
  }
  return { sampleCount, dataOffset, sampleBytes };
}

function hasValidMp4Tfdt(data: Uint8Array, box: IsoBox): boolean {
  const payloadSize = box.end - box.payloadStart;
  const version = data[box.payloadStart];
  if (fullBoxFlags(data, box) !== 0) return false;
  if (version === 0) return payloadSize === 8;
  if (version === 1)
    return (
      payloadSize === 12 && readMp4Uint64(data, box.payloadStart + 4) !== null
    );
  return false;
}

function hasValidFragmentedMp4Video(
  data: Uint8Array,
  topLevelBoxes: IsoBox[],
  movie: IsoBox,
  mediaDataBoxes: IsoBox[],
): boolean {
  const movieBoxes = readIsoBoxes(data, movie.payloadStart, movie.end);
  const movieHeader = movieBoxes ? singleIsoBox(movieBoxes, "mvhd") : null;
  if (!movieBoxes || !movieHeader) return false;
  const movieHeaderVersion = data[movieHeader.payloadStart];
  if (
    (movieHeaderVersion === 0 &&
      movieHeader.end - movieHeader.payloadStart < 100) ||
    (movieHeaderVersion === 1 &&
      movieHeader.end - movieHeader.payloadStart < 112) ||
    (movieHeaderVersion !== 0 && movieHeaderVersion !== 1) ||
    fullBoxFlags(data, movieHeader) === null
  )
    return false;
  const movieExtends = singleIsoBox(movieBoxes, "mvex");
  if (!movieExtends) return false;

  const tracks = new Map<number, Mp4TrackMetadata>();
  for (const trackBox of movieBoxes.filter((box) => box.type === "trak")) {
    const track = readMp4TrackMetadata(data, trackBox);
    if (
      !track ||
      tracks.has(track.trackId) ||
      !hasEmptyMp4SampleTables(data, track.sampleTableBoxes)
    )
      return false;
    tracks.set(track.trackId, track);
  }
  if (![...tracks.values()].some((track) => track.isVideo)) return false;
  const trexDefaults = readMp4TrexDefaults(data, movieExtends, tracks);
  if (!trexDefaults) return false;

  const movieFragments = topLevelBoxes.filter((box) => box.type === "moof");
  if (movieFragments.length === 0) return false;
  let totalSamples = 0;
  let hasVideoSamples = false;
  for (const moof of movieFragments) {
    const moofBoxes = readIsoBoxes(data, moof.payloadStart, moof.end);
    const movieFragmentHeader = moofBoxes
      ? singleIsoBox(moofBoxes, "mfhd")
      : null;
    const trafBoxes = moofBoxes?.filter((box) => box.type === "traf") ?? [];
    if (
      !moofBoxes ||
      !movieFragmentHeader ||
      movieFragmentHeader.end - movieFragmentHeader.payloadStart !== 8 ||
      data[movieFragmentHeader.payloadStart] !== 0 ||
      fullBoxFlags(data, movieFragmentHeader) !== 0 ||
      uint32(data, movieFragmentHeader.payloadStart + 4) === 0 ||
      trafBoxes.length === 0
    )
      return false;

    let previousTrafEnd: number | null = moof.start;
    for (let trafIndex = 0; trafIndex < trafBoxes.length; trafIndex++) {
      const traf = trafBoxes[trafIndex]!;
      const trafChildren = readIsoBoxes(data, traf.payloadStart, traf.end);
      const tfhdBox = trafChildren ? singleIsoBox(trafChildren, "tfhd") : null;
      const tfdtBoxes =
        trafChildren?.filter((box) => box.type === "tfdt") ?? [];
      const trunBoxes =
        trafChildren?.filter((box) => box.type === "trun") ?? [];
      if (
        !trafChildren ||
        !tfhdBox ||
        tfdtBoxes.length > 1 ||
        (tfdtBoxes[0] && !hasValidMp4Tfdt(data, tfdtBoxes[0])) ||
        trunBoxes.length === 0
      )
        return false;

      const trackId = uint32(data, tfhdBox.payloadStart + 4);
      const track = tracks.get(trackId);
      const defaults = trexDefaults.get(trackId);
      if (!track || !defaults) return false;
      const tfhd = readMp4Tfhd(data, tfhdBox, moof.start, defaults, track);
      if (!tfhd) return false;
      const baseDataOffset = tfhd.baseDataOffset ?? previousTrafEnd;
      if (baseDataOffset === null) return false;

      let previousRunEnd: number | null = null;
      let trafDataEnd: number | null = null;
      let trafSampleCount = 0;
      for (const trunBox of trunBoxes) {
        const trun = readMp4Trun(
          data,
          trunBox,
          tfhd,
          MAX_MEDIA_SAMPLE_ENTRIES - totalSamples,
        );
        if (!trun) return false;
        totalSamples += trun.sampleCount;
        trafSampleCount += trun.sampleCount;
        if (
          !Number.isSafeInteger(totalSamples) ||
          totalSamples > MAX_MEDIA_SAMPLE_ENTRIES
        )
          return false;
        if (trun.sampleCount === 0) continue;
        if (tfhd.durationIsEmpty) return false;

        const runStart: number =
          trun.dataOffset === null
            ? (previousRunEnd ?? baseDataOffset)
            : baseDataOffset + trun.dataOffset;
        const runEnd: number = runStart + trun.sampleBytes;
        if (
          !Number.isSafeInteger(runStart) ||
          !Number.isSafeInteger(runEnd) ||
          !isMediaDataRange(runStart, trun.sampleBytes, mediaDataBoxes)
        )
          return false;
        previousRunEnd = runEnd;
        trafDataEnd =
          trafDataEnd === null ? runEnd : Math.max(trafDataEnd, runEnd);
      }
      if (tfhd.durationIsEmpty && trafSampleCount !== 0) return false;
      if (trafDataEnd !== null) previousTrafEnd = trafDataEnd;
      if (track.isVideo && trafSampleCount > 0) hasVideoSamples = true;
    }
  }
  return hasVideoSamples;
}

function readEbmlVint(
  data: Uint8Array,
  offset: number,
  maxWidth: number,
  keepMarker: boolean,
): { value: number; width: number; unknown: boolean } | null {
  const first = data[offset];
  if (first === undefined || first === 0) return null;
  let marker = 0x80;
  let width = 1;
  while ((first & marker) === 0 && width <= maxWidth) {
    marker >>= 1;
    width++;
  }
  if (width > maxWidth || offset + width > data.length) return null;
  const firstValue = keepMarker ? first : first & (marker - 1);
  const unknown =
    !keepMarker &&
    firstValue === marker - 1 &&
    data.subarray(offset + 1, offset + width).every((byte) => byte === 0xff);
  if (unknown) return { value: 0, width, unknown: true };
  let value = firstValue;
  for (let index = 1; index < width; index++) {
    value = value * 256 + data[offset + index]!;
    if (!Number.isSafeInteger(value)) return null;
  }
  return { value, width, unknown };
}

function readEbmlElements(
  data: Uint8Array,
  start: number,
  end: number,
  unknownSizeIds: ReadonlySet<number> = new Set(),
  unknownSizeSiblingIds: ReadonlySet<number> = new Set(),
): EbmlElement[] | null {
  const elements: EbmlElement[] = [];
  let offset = start;
  while (offset < end) {
    if (elements.length >= MAX_MEDIA_CONTAINER_ELEMENTS) return null;
    const id = readEbmlVint(data, offset, 4, true);
    if (!id) return null;
    const size = readEbmlVint(data, offset + id.width, 8, false);
    if (!size) return null;
    const payloadStart = offset + id.width + size.width;
    if (payloadStart > end) return null;
    if (size.unknown && !unknownSizeIds.has(id.value)) return null;
    const elementEnd = size.unknown
      ? id.value === EBML_CLUSTER_ID
        ? findUnknownSizeClusterEnd(
            data,
            payloadStart,
            end,
            unknownSizeSiblingIds,
          )
        : end
      : payloadStart + size.value;
    if (elementEnd === null) return null;
    if (elementEnd > end || elementEnd < payloadStart) return null;
    elements.push({ id: id.value, payloadStart, end: elementEnd });
    offset = elementEnd;
  }
  return offset === end ? elements : null;
}

function findUnknownSizeClusterEnd(
  data: Uint8Array,
  start: number,
  end: number,
  siblingIds: ReadonlySet<number>,
): number | null {
  let offset = start;
  let count = 0;
  while (offset < end) {
    if (count++ >= MAX_MEDIA_CONTAINER_ELEMENTS) return null;
    const id = readEbmlVint(data, offset, 4, true);
    if (!id) return null;
    if (siblingIds.has(id.value)) return offset;
    const size = readEbmlVint(data, offset + id.width, 8, false);
    if (!size || size.unknown) return null;
    const payloadStart = offset + id.width + size.width;
    if (payloadStart > end) return null;
    const childEnd = payloadStart + size.value;
    if (childEnd > end || childEnd < payloadStart) return null;
    offset = childEnd;
  }
  return offset === end ? end : null;
}

function hasNoNestedSegmentLevelWebmElements(
  data: Uint8Array,
  elements: EbmlElement[],
): boolean {
  const pending = [...elements];
  let visited = 0;
  while (pending.length > 0) {
    if (visited++ >= MAX_MEDIA_CONTAINER_ELEMENTS) return false;
    const element = pending.pop()!;
    if (EBML_SEGMENT_LEVEL_IDS.has(element.id)) return false;
    if (!EBML_NESTED_MASTER_IDS.has(element.id)) continue;
    const children = readEbmlElements(data, element.payloadStart, element.end);
    if (!children) return false;
    for (const child of children) pending.push(child);
  }
  return true;
}

function ebmlUnsigned(data: Uint8Array, element: EbmlElement): number | null {
  const size = element.end - element.payloadStart;
  if (size < 1 || size > 8) return null;
  let value = 0;
  for (let offset = element.payloadStart; offset < element.end; offset++) {
    value = value * 256 + data[offset]!;
    if (!Number.isSafeInteger(value)) return null;
  }
  return value;
}

function hasWebmVideoTrack(
  data: Uint8Array,
  tracks: EbmlElement,
): Set<number> | null {
  const entries = readEbmlElements(data, tracks.payloadStart, tracks.end);
  if (!entries) return null;
  const videoTracks = new Set<number>();
  for (const entry of entries) {
    if (entry.id !== 0xae) continue;
    const fields = readEbmlElements(data, entry.payloadStart, entry.end);
    if (!fields) return null;
    const numberField = fields.find((field) => field.id === 0xd7);
    const typeField = fields.find((field) => field.id === 0x83);
    const codecField = fields.find((field) => field.id === 0x86);
    if (!numberField || !typeField || !codecField) continue;
    const number = ebmlUnsigned(data, numberField);
    const type = ebmlUnsigned(data, typeField);
    const codec = Buffer.from(
      data.subarray(codecField.payloadStart, codecField.end),
    ).toString("utf8");
    if (number && type === 1 && codec.startsWith("V_")) videoTracks.add(number);
  }
  return videoTracks.size > 0 ? videoTracks : null;
}

function ebmlBlockTrackNumber(
  data: Uint8Array,
  block: EbmlElement,
  videoTracks: Set<number>,
): boolean {
  const track = readEbmlVint(data, block.payloadStart, 8, false);
  return (
    !!track &&
    !track.unknown &&
    videoTracks.has(track.value) &&
    block.end - (block.payloadStart + track.width) >= 4
  );
}

function hasWebmVideoData(
  data: Uint8Array,
  children: EbmlElement[],
  videoTracks: Set<number>,
): boolean {
  const timecode = children.find((child) => child.id === 0xe7);
  if (!timecode || ebmlUnsigned(data, timecode) === null) return false;
  return children.some((child) => {
    if (child.id === 0xa3)
      return ebmlBlockTrackNumber(data, child, videoTracks);
    if (child.id !== 0xa0) return false;
    const group = readEbmlElements(data, child.payloadStart, child.end);
    const block = group?.find((item) => item.id === 0xa1);
    return !!block && ebmlBlockTrackNumber(data, block, videoTracks);
  });
}

function hasValidWebmVideo(data: Uint8Array): boolean {
  const root = readEbmlElements(
    data,
    0,
    data.length,
    new Set([EBML_SEGMENT_ID]),
  );
  if (!root || root[0]?.id !== 0x1a45dfa3) return false;
  const header = readEbmlElements(data, root[0].payloadStart, root[0].end);
  const docType = header?.find((element) => element.id === 0x4282);
  if (
    !docType ||
    Buffer.from(data.subarray(docType.payloadStart, docType.end)).toString(
      "utf8",
    ) !== "webm"
  )
    return false;
  const segment = root.find((element) => element.id === 0x18538067);
  if (!segment) return false;
  const segmentChildren = readEbmlElements(
    data,
    segment.payloadStart,
    segment.end,
    new Set([EBML_CLUSTER_ID]),
    EBML_SEGMENT_LEVEL_IDS,
  );
  if (!segmentChildren) return false;
  const infos = segmentChildren.filter((element) => element.id === 0x1549a966);
  const tracks = segmentChildren.filter((element) => element.id === 0x1654ae6b);
  const info = infos[0];
  const tracksElement = tracks[0];
  if (infos.length !== 1 || tracks.length !== 1 || !info || !tracksElement)
    return false;
  if (!readEbmlElements(data, info.payloadStart, info.end)) return false;
  const videoTracks = hasWebmVideoTrack(data, tracksElement);
  if (!videoTracks) return false;
  let hasVideoData = false;
  for (const cluster of segmentChildren.filter(
    (element) => element.id === EBML_CLUSTER_ID,
  )) {
    const children = readEbmlElements(data, cluster.payloadStart, cluster.end);
    if (!children || !hasNoNestedSegmentLevelWebmElements(data, children))
      return false;
    if (hasWebmVideoData(data, children, videoTracks)) hasVideoData = true;
  }
  return hasVideoData;
}

export function hasExpectedSvgSignature(data: Uint8Array): boolean {
  const normalizedData = stripSafeSvgDoctype(data);
  if (!normalizedData) return false;
  const head = Buffer.from(
    normalizedData.subarray(0, Math.min(normalizedData.length, 8192)),
  ).toString("utf8");
  const normalized = head.replace(/^\uFEFF/, "").trimStart();
  return /^(?:(?:\s|<!--[\s\S]*?-->|<\?xml\b[\s\S]*?\?>))*<svg(?:\s|\/?>)/i.test(
    normalized,
  );
}

function hasExpectedImageSignature(ext: string, data: Uint8Array): boolean {
  if (ext === ".png") {
    return (
      data[0] === 0x89 &&
      data[1] === 0x50 &&
      data[2] === 0x4e &&
      data[3] === 0x47
    );
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (ext === ".gif") {
    const header = ascii(data, 0, 6);
    return header === "GIF87a" || header === "GIF89a";
  }
  if (ext === ".webp") {
    return ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 12) === "WEBP";
  }
  if (ext === ".ico") {
    return (
      data[0] === 0x00 &&
      data[1] === 0x00 &&
      data[2] === 0x01 &&
      data[3] === 0x00
    );
  }
  if (ext === ".avif") {
    return ascii(data, 4, 12).includes("ftyp");
  }
  if (ext === ".svg") {
    return hasExpectedSvgSignature(data);
  }
  return false;
}

function decodeXmlReferences(source: string): string {
  const namedReferences: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"',
  };
  return source.replace(
    /&#x([0-9a-f]+);|&#([0-9]+);|&([a-z]+);/gi,
    (
      match,
      hex: string | undefined,
      decimal: string | undefined,
      named: string | undefined,
    ) => {
      const codePoint = hex
        ? Number.parseInt(hex, 16)
        : decimal
          ? Number.parseInt(decimal, 10)
          : undefined;
      if (
        codePoint !== undefined &&
        codePoint <= 0x10ffff &&
        !(codePoint >= 0xd800 && codePoint <= 0xdfff)
      ) {
        return String.fromCodePoint(codePoint);
      }
      return named ? (namedReferences[named.toLowerCase()] ?? match) : match;
    },
  );
}

function decodeCssEscapes(source: string): string {
  return source
    .replace(/\\(?:\r\n|[\r\n\f])/g, "")
    .replace(
      /\\([0-9a-f]{1,6})(?:[ \t\r\n\f])?|\\([^\r\n])/gi,
      (match, hex: string | undefined, character: string | undefined) => {
        if (!hex) return character ?? match;
        const codePoint = Number.parseInt(hex, 16);
        if (
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return match;
        }
        return String.fromCodePoint(codePoint);
      },
    );
}

export function isSafeSvg(data: Uint8Array): boolean {
  const normalizedData = stripSafeSvgDoctype(data);
  if (!normalizedData) return false;
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(normalizedData);
  } catch {
    // coercion-ok: malformed UTF-8 must reject SVG validation.
    return false;
  }
  source = source.replace(/^\uFEFF/, "").trim();
  const normalizedSource = decodeCssEscapes(
    decodeXmlReferences(source),
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  const forbidden = [
    /<\s*(?:script|foreignObject|iframe|object|embed|link|audio|video|animate(?:Transform|Motion|Color)?|set|discard)\b/i,
    /<\s*\/?[a-z_][\w.-]*:[a-z_][\w.-]*\b/i,
    /<!\s*(?:DOCTYPE|ENTITY)\b/i,
    /<\?xml-stylesheet\b/i,
    /\bxml:base\s*=/i,
    /\son[a-z][a-z0-9:_-]*\s*=/i,
    /\b(?:javascript|vbscript)\s*:/i,
    /\b(?:expression|behavior|-moz-binding)\s*\(/i,
    /@import\b/i,
    /\b(?:image|(?:-webkit-)?image-set)\s*\(/i,
  ];
  if (forbidden.some((pattern) => pattern.test(normalizedSource))) return false;

  for (const match of normalizedSource.matchAll(
    /(?:href|xlink:href)\s*=\s*(?:(['"])(.*?)\1|([^\s>]+))/gi,
  )) {
    const target = (match[2] ?? match[3] ?? match[4] ?? "").trim();
    if (target && !target.startsWith("#") && !isAllowedInlineSvgAsset(target)) {
      return false;
    }
  }
  for (const match of normalizedSource.matchAll(
    /url\(\s*(["']?)(.*?)\1\s*\)/gi,
  )) {
    const target = match[2]?.trim() ?? "";
    if (target && !target.startsWith("#") && !isAllowedInlineSvgAsset(target)) {
      return false;
    }
  }
  return true;
}

function isAllowedInlineSvgAsset(target: string): boolean {
  const dataUrl = parseBase64DataUrl(target);
  return Boolean(
    dataUrl &&
    ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
      dataUrl.mediaType,
    ),
  );
}

export function canSaveAsUploadedAsset(args: {
  originalName: string;
  data: Uint8Array;
}): boolean {
  const ext = path.extname(args.originalName).toLowerCase();
  return (
    args.data.length <= MAX_ASSET_FILE_SIZE &&
    isImageAssetExtension(ext) &&
    (ext !== ".svg" ||
      (hasExpectedImageSignature(ext, args.data) && isSafeSvg(args.data)))
  );
}

export async function uploadImageAsset(args: {
  email: string;
  orgId?: string | null;
  originalName: string;
  data: Uint8Array;
  type?: string;
}): Promise<UploadedAsset> {
  if (args.data.length > MAX_ASSET_FILE_SIZE) {
    throw new Error("File too large (max 10 MB)");
  }

  const ext = path.extname(args.originalName).toLowerCase();
  if (!isImageAssetExtension(ext)) {
    throw new Error(
      "Only image files are allowed (jpg, png, gif, webp, avif, ico, svg)",
    );
  }
  if (!hasExpectedImageSignature(ext, args.data)) {
    throw new Error("Uploaded image bytes do not match file extension");
  }

  let data = args.data;
  if (ext === ".svg") {
    const normalizedSvg = stripSafeSvgDoctype(data);
    if (!normalizedSvg || !isSafeSvg(normalizedSvg)) {
      throw new Error("SVG contains active content or external references");
    }
    data = normalizedSvg;
  }

  const mimeType = ext === ".svg" ? "image/svg+xml" : args.type;

  const orgId =
    args.orgId === undefined ? getRequestOrgId() : (args.orgId ?? undefined);
  const result = await runWithRequestContext(
    { userEmail: args.email, ...(orgId === undefined ? {} : { orgId }) },
    () =>
      uploadFile({
        data,
        filename: args.originalName,
        mimeType,
        ownerEmail: args.email,
      }),
  );

  if (!result) {
    const err: Error & { statusCode?: number } = new Error(
      "No object storage is connected. Use Builder.io (free) or configure your own S3-compatible storage keys in Settings → File uploads.",
    );
    err.statusCode = 503;
    throw err;
  }

  const asset: UploadedAsset = {
    url: result.url,
    filename: args.originalName,
    type: mimeType || "application/octet-stream",
    size: data.length,
    provider: result.provider,
  };

  const db = getDb();
  await db.insert(schema.uploadedAssets).values({
    id: nanoid(),
    filename: asset.filename,
    url: asset.url,
    type: asset.type,
    size: asset.size,
    provider: asset.provider ?? null,
    orgId: orgId ?? null,
    ownerEmail: args.email,
    createdAt: new Date().toISOString(),
  });

  return asset;
}

export function canSaveAsUploadedVideoAsset(args: {
  originalName: string;
  data: Uint8Array;
}): boolean {
  const ext = path.extname(args.originalName).toLowerCase();
  if (args.data.length > MAX_VIDEO_ASSET_FILE_SIZE) return false;
  if (ext === ".mp4") return hasValidMp4Video(args.data);
  return ext === ".webm" && hasValidWebmVideo(args.data);
}

function uploadedVideoError(
  message: string,
  statusCode: number,
): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

async function deleteUploadedVideoAssetRow(
  id: string,
  ownerEmail: string,
  orgId: string | null | undefined,
): Promise<void> {
  await getDb()
    .delete(schema.uploadedAssets)
    .where(
      and(
        eq(schema.uploadedAssets.id, id),
        eq(schema.uploadedAssets.ownerEmail, ownerEmail),
        orgId
          ? eq(schema.uploadedAssets.orgId, orgId)
          : isNull(schema.uploadedAssets.orgId),
      ),
    );
}

async function findUploadedVideoAssetById(
  email: string,
  assetId: string,
  requestedOrgId: string | null | undefined,
): Promise<UploadedVideoAsset | null> {
  const orgId = requestedOrgId ?? undefined;
  const [asset] = await getDb()
    .select({
      id: schema.uploadedAssets.id,
      filename: schema.uploadedAssets.filename,
      url: schema.uploadedAssets.url,
      type: schema.uploadedAssets.type,
      size: schema.uploadedAssets.size,
      provider: schema.uploadedAssets.provider,
    })
    .from(schema.uploadedAssets)
    .where(
      and(
        eq(schema.uploadedAssets.id, assetId),
        eq(schema.uploadedAssets.ownerEmail, email),
        orgId
          ? eq(schema.uploadedAssets.orgId, orgId)
          : isNull(schema.uploadedAssets.orgId),
      ),
    )
    .limit(1);
  if (!asset || !asset.type.startsWith("video/")) return null;
  return { ...asset, provider: asset.provider ?? undefined };
}

async function uploadedVideoAssetRowExists(
  id: string,
  ownerEmail: string,
  orgId: string | null | undefined,
): Promise<boolean> {
  return Boolean(await findUploadedVideoAssetById(ownerEmail, id, orgId));
}

export async function reapOrphanedVideoAssetObjects(
  ownerEmail: string,
  orgId: string | undefined,
): Promise<void> {
  const requestContext = {
    userEmail: ownerEmail,
    ...(orgId === undefined ? {} : { orgId }),
  };
  let cleanups: Awaited<ReturnType<typeof listOrphanedVideoAssetCleanups>>;
  try {
    cleanups = await runWithRequestContext(requestContext, () =>
      listOrphanedVideoAssetCleanups(),
    );
  } catch (error) {
    console.warn("[slides-upload] could not read orphaned video receipts", {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  await Promise.all(
    cleanups.map(async ({ key, cleanup }) => {
      if (
        cleanup.version !== 1 ||
        cleanup.ownerEmail !== ownerEmail ||
        (cleanup.orgId ?? null) !== (orgId ?? null) ||
        !cleanup.provider ||
        !cleanup.url ||
        (cleanup.assetId !== undefined &&
          (typeof cleanup.assetId !== "string" || !cleanup.assetId)) ||
        (cleanup.preserveIfAssetExists !== undefined &&
          (typeof cleanup.preserveIfAssetExists !== "boolean" ||
            (cleanup.preserveIfAssetExists && !cleanup.assetId))) ||
        (cleanup.providerObjectId !== null &&
          typeof cleanup.providerObjectId !== "string")
      ) {
        return;
      }
      try {
        if (
          cleanup.assetId &&
          cleanup.preserveIfAssetExists &&
          (await runWithRequestContext(requestContext, () =>
            uploadedVideoAssetRowExists(cleanup.assetId!, ownerEmail, orgId),
          ))
        ) {
          await runWithRequestContext(requestContext, () =>
            deleteOrphanedVideoAssetCleanup(key),
          );
          return;
        }
        if (cleanup.assetId && !cleanup.preserveIfAssetExists) {
          await runWithRequestContext(requestContext, () =>
            deleteUploadedVideoAssetRow(cleanup.assetId!, ownerEmail, orgId),
          );
        }
        const deleted = await runWithRequestContext(requestContext, () =>
          deleteUploadedFile(cleanup.provider, {
            id: cleanup.providerObjectId ?? undefined,
            url: cleanup.url,
          }),
        );
        if (deleted) {
          await runWithRequestContext(requestContext, () =>
            deleteOrphanedVideoAssetCleanup(key),
          );
        }
      } catch (error) {
        console.warn("[slides-upload] orphaned video object retry failed", {
          uploadSessionId: cleanup.uploadSessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );
}

export async function uploadVideoAsset(args: {
  email: string;
  orgId?: string | null;
  originalName: string;
  data: Uint8Array;
  uploadSessionId?: string;
}): Promise<UploadedVideoAsset> {
  if (args.data.length > MAX_VIDEO_ASSET_FILE_SIZE) {
    throw uploadedVideoError("Video too large (max 50 MB)", 413);
  }
  if (!canSaveAsUploadedVideoAsset(args)) {
    throw uploadedVideoError("Only valid MP4 and WebM videos are allowed", 400);
  }

  const orgId =
    args.orgId === undefined ? getRequestOrgId() : (args.orgId ?? undefined);
  const requestContext = {
    userEmail: args.email,
    ...(orgId === undefined ? {} : { orgId }),
  };
  await reapOrphanedVideoAssetObjects(args.email, orgId);

  if (args.uploadSessionId) {
    const completed = await findUploadedVideoAssetForSession(
      args.email,
      args.uploadSessionId,
      orgId ?? null,
    );
    if (completed) return completed;
  }

  const ext = path.extname(args.originalName).toLowerCase();
  const mimeType = ext === ".mp4" ? "video/mp4" : "video/webm";
  const result = await runWithRequestContext(requestContext, () =>
    uploadFile({
      data: args.data,
      filename: args.originalName,
      mimeType,
      ownerEmail: args.email,
    }),
  );

  if (!result) {
    const err: Error & { statusCode?: number } = new Error(
      "No object storage is connected. Use Builder.io (free) or configure your own S3-compatible storage keys in Settings → File uploads.",
    );
    err.statusCode = 503;
    throw err;
  }

  const id = nanoid();
  const asset: UploadedVideoAsset = {
    id,
    url: result.url,
    filename: args.originalName,
    type: mimeType,
    size: args.data.length,
    provider: result.provider,
  };

  try {
    await getDb()
      .insert(schema.uploadedAssets)
      .values({
        id: asset.id,
        filename: asset.filename,
        url: asset.url,
        type: asset.type,
        size: asset.size,
        provider: asset.provider ?? null,
        providerObjectId: result.id ?? null,
        uploadSessionId: args.uploadSessionId ?? null,
        orgId: orgId ?? null,
        ownerEmail: args.email,
        createdAt: new Date().toISOString(),
      });
  } catch (insertError) {
    let committedAsset: UploadedVideoAsset | null = null;
    let assetLookupFailed = false;
    try {
      committedAsset = await findUploadedVideoAssetById(
        args.email,
        asset.id,
        orgId ?? null,
      );
    } catch {
      assetLookupFailed = true;
    }
    if (committedAsset) return committedAsset;

    let completed: UploadedVideoAsset | null = null;
    let sessionLookupFailed = false;
    if (args.uploadSessionId) {
      try {
        completed = await findUploadedVideoAssetForSession(
          args.email,
          args.uploadSessionId,
          orgId ?? null,
        );
      } catch {
        sessionLookupFailed = true;
      }
    }

    if (completed?.id === asset.id) return completed;
    const cleanupUncertain = assetLookupFailed || sessionLookupFailed;

    const cleanupKey = `${args.uploadSessionId ?? asset.id}`;
    let cleanupRecord: string | undefined;
    try {
      cleanupRecord = await runWithRequestContext(requestContext, () =>
        recordOrphanedVideoAssetCleanup({
          version: 1,
          ownerEmail: args.email,
          orgId: orgId ?? null,
          ...(cleanupUncertain
            ? { assetId: asset.id, preserveIfAssetExists: true }
            : {}),
          provider: result.provider,
          providerObjectId: result.id ?? null,
          url: result.url,
          uploadSessionId: args.uploadSessionId ?? null,
          createdAt: new Date().toISOString(),
        }),
      );
    } catch (error) {
      console.warn("[slides-upload] could not record orphaned video object", {
        cleanupKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (cleanupUncertain) {
      if (!cleanupRecord) {
        console.error("[slides-upload] uncertain video object is untracked", {
          cleanupKey,
        });
      }
      if (completed && cleanupRecord) return completed;
      throw insertError;
    }

    let objectDeleted = false;
    try {
      const deleted = await runWithRequestContext(requestContext, () =>
        deleteUploadedFile(result.provider, {
          id: result.id ?? undefined,
          url: result.url,
        }),
      );
      objectDeleted = deleted;
      if (deleted && cleanupRecord) {
        try {
          await runWithRequestContext(requestContext, () =>
            deleteOrphanedVideoAssetCleanup(cleanupRecord!),
          );
        } catch (error) {
          console.warn(
            "[slides-upload] orphaned video cleanup receipt remains",
            {
              cleanupKey,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }
      if (!deleted && !cleanupRecord) {
        console.error("[slides-upload] orphaned video object is untracked", {
          cleanupKey,
        });
      }
    } catch (error) {
      console.warn("[slides-upload] could not delete orphaned video object", {
        cleanupKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (completed && (objectDeleted || cleanupRecord)) return completed;
    throw insertError;
  }

  return asset;
}

export async function findUploadedVideoAssetForSession(
  email: string,
  uploadSessionId: string,
  requestedOrgId?: string | null,
): Promise<UploadedVideoAsset | null> {
  const orgId =
    requestedOrgId === undefined
      ? getRequestOrgId()
      : (requestedOrgId ?? undefined);
  const [asset] = await getDb()
    .select({
      id: schema.uploadedAssets.id,
      filename: schema.uploadedAssets.filename,
      url: schema.uploadedAssets.url,
      type: schema.uploadedAssets.type,
      size: schema.uploadedAssets.size,
      provider: schema.uploadedAssets.provider,
    })
    .from(schema.uploadedAssets)
    .where(
      and(
        eq(schema.uploadedAssets.ownerEmail, email),
        eq(schema.uploadedAssets.uploadSessionId, uploadSessionId),
        orgId
          ? eq(schema.uploadedAssets.orgId, orgId)
          : isNull(schema.uploadedAssets.orgId),
      ),
    )
    .limit(1);

  if (!asset || !asset.type.startsWith("video/")) return null;
  return {
    id: asset.id,
    filename: asset.filename,
    url: asset.url,
    type: asset.type,
    size: asset.size,
    provider: asset.provider ?? undefined,
  };
}

export const uploadVideoAssetHandler = defineEventHandler(async (event) => {
  const { session, error: authError } = await requireSession(event);
  if (!session) {
    return { error: authError };
  }

  let parts;
  try {
    parts = await readBoundedMultipartFormData(
      event,
      MAX_VIDEO_ASSET_REQUEST_SIZE,
    );
  } catch (error) {
    return multipartUploadError(event, error, "Video upload failed");
  }
  const filePart = parts?.find((part) => part.name === "file");
  if (!filePart?.data) {
    setResponseStatus(event, 400);
    return { error: "No video uploaded" };
  }
  if (filePart.data.length > MAX_VIDEO_ASSET_FILE_SIZE) {
    setResponseStatus(event, 413);
    return { error: "Video too large (max 50 MB)" };
  }

  try {
    return await uploadVideoAsset({
      email: session.email,
      orgId: session.orgId,
      originalName: filePart.filename || "video",
      data: filePart.data,
    });
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode ?? 500;
    setResponseStatus(event, status);
    return {
      error: error instanceof Error ? error.message : "Video upload failed",
    };
  }
});

export const discardUploadedVideoAsset = defineEventHandler(async (event) => {
  const { session, error } = await requireSession(event);
  if (!session) return { error };

  const rawId = getQuery(event).id;
  const id = typeof rawId === "string" ? rawId.trim() : "";
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Video asset id is required" };
  }

  const db = getDb();
  const [asset] = await db
    .select({
      id: schema.uploadedAssets.id,
      url: schema.uploadedAssets.url,
      provider: schema.uploadedAssets.provider,
      providerObjectId: schema.uploadedAssets.providerObjectId,
      type: schema.uploadedAssets.type,
      orgId: schema.uploadedAssets.orgId,
    })
    .from(schema.uploadedAssets)
    .where(
      and(
        eq(schema.uploadedAssets.id, id),
        eq(schema.uploadedAssets.ownerEmail, session.email),
        session.orgId
          ? eq(schema.uploadedAssets.orgId, session.orgId)
          : isNull(schema.uploadedAssets.orgId),
      ),
    )
    .limit(1);

  if (!asset) return { success: true };
  if (!asset.type.startsWith("video/") || !asset.provider) {
    setResponseStatus(event, 404);
    return { error: "Uploaded video asset was not found" };
  }

  const provider = asset.provider;
  const requestContext = {
    userEmail: session.email,
    ...(asset.orgId ? { orgId: asset.orgId } : {}),
  };
  let cleanupKey: string;
  try {
    cleanupKey = await runWithRequestContext(requestContext, () =>
      recordOrphanedVideoAssetCleanup({
        version: 1,
        ownerEmail: session.email,
        orgId: asset.orgId ?? null,
        assetId: asset.id,
        provider,
        providerObjectId: asset.providerObjectId ?? null,
        url: asset.url,
        uploadSessionId: null,
        createdAt: new Date().toISOString(),
      }),
    );
  } catch (error) {
    console.warn("[slides-upload] could not record discarded video cleanup", {
      assetId: asset.id,
      error: error instanceof Error ? error.message : String(error),
    });
    setResponseStatus(event, 503);
    return { error: "Could not discard uploaded video" };
  }

  try {
    await deleteUploadedVideoAssetRow(asset.id, session.email, asset.orgId);
  } catch (error) {
    console.warn("[slides-upload] could not remove discarded video record", {
      assetId: asset.id,
      error: error instanceof Error ? error.message : String(error),
    });
    setResponseStatus(event, 503);
    return { error: "Could not discard uploaded video" };
  }

  try {
    const deleted = await runWithRequestContext(requestContext, () =>
      deleteUploadedFile(provider, {
        id: asset.providerObjectId ?? undefined,
        url: asset.url,
      }),
    );
    if (deleted) {
      await runWithRequestContext(requestContext, () =>
        deleteOrphanedVideoAssetCleanup(cleanupKey),
      );
    } else {
      console.warn("[slides-upload] discarded video cleanup queued", {
        assetId: asset.id,
      });
    }
  } catch (error) {
    console.warn("[slides-upload] discarded video cleanup queued", {
      assetId: asset.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return { success: true };
});

export const uploadAsset = defineEventHandler(async (event) => {
  const { session, error: authError } = await requireSession(event);
  if (!session) {
    return { error: authError };
  }

  let parts;
  try {
    parts = await readBoundedMultipartFormData(event, MAX_ASSET_REQUEST_SIZE);
  } catch (error) {
    return multipartUploadError(event, error, "Image upload failed");
  }
  const filePart = parts?.find((p) => p.name === "file");
  if (!filePart || !filePart.data) {
    setResponseStatus(event, 400);
    return { error: "No file uploaded" };
  }

  if (filePart.data.length > MAX_ASSET_FILE_SIZE) {
    setResponseStatus(event, 413);
    return { error: "File too large (max 10 MB)" };
  }

  try {
    return await uploadImageAsset({
      email: session.email,
      orgId: session.orgId,
      originalName: filePart.filename || "upload",
      data: filePart.data,
      type: filePart.type,
    });
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode ?? 400;
    setResponseStatus(event, status);
    return {
      error: error instanceof Error ? error.message : "Image upload failed",
    };
  }
});

export const listAssets = defineEventHandler(async (event) => {
  const { session, error } = await requireSession(event);
  if (!session) {
    return { error };
  }
  const db = getDb();
  const rows: ListedUploadedAsset[] = await db
    .select({
      id: schema.uploadedAssets.id,
      url: schema.uploadedAssets.url,
      filename: schema.uploadedAssets.filename,
      size: schema.uploadedAssets.size,
      createdAt: schema.uploadedAssets.createdAt,
    })
    .from(schema.uploadedAssets)
    .where(
      and(
        eq(schema.uploadedAssets.ownerEmail, session.email),
        imageAssetWorkspaceScope(session.orgId),
        notLike(schema.uploadedAssets.type, "video/%"),
      ),
    )
    .orderBy(desc(schema.uploadedAssets.createdAt));
  return rows;
});

export const deleteAsset = defineEventHandler(async (event) => {
  const { session, error } = await requireSession(event);
  if (!session) {
    return { error };
  }
  const id = getRouterParam(event, "id");
  if (!id) {
    setResponseStatus(event, 400);
    return { error: "Asset id is required" };
  }
  const db = getDb();
  await db
    .delete(schema.uploadedAssets)
    .where(
      and(
        eq(schema.uploadedAssets.id, decodeURIComponent(id)),
        eq(schema.uploadedAssets.ownerEmail, session.email),
        imageAssetWorkspaceScope(session.orgId),
      ),
    );
  return { success: true };
});
