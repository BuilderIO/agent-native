import path from "path";

import { uploadFile } from "@agent-native/core/file-upload";
import {
  getRequestOrgId,
  runWithRequestContext,
} from "@agent-native/core/server";
import { parseBase64DataUrl } from "@agent-native/core/shared";
import { and, desc, eq, notLike } from "drizzle-orm";
import {
  assertBodySize,
  defineEventHandler,
  getRouterParam,
  setResponseStatus,
  readMultipartFormData,
} from "h3";
import { nanoid } from "nanoid";

import { getDb, schema } from "../db/index.js";
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

export interface UploadedAsset {
  url: string;
  filename: string;
  type: string;
  size: number;
  provider?: string;
}

export interface ListedUploadedAsset {
  id: string;
  url: string;
  filename: string;
  size: number;
  createdAt: string;
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
      entries.every((entry) => entry.end - entry.start >= 86) &&
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
  return hasMp4VideoTrack(data, movie, mediaDataBoxes);
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
  cluster: EbmlElement,
  videoTracks: Set<number>,
): boolean {
  const children = readEbmlElements(data, cluster.payloadStart, cluster.end);
  if (!children) return false;
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
  return segmentChildren.some(
    (element) =>
      element.id === 0x1f43b675 && hasWebmVideoData(data, element, videoTracks),
  );
}

export function hasExpectedSvgSignature(data: Uint8Array): boolean {
  const head = Buffer.from(
    data.subarray(0, Math.min(data.length, 8192)),
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
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(data);
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

  if (ext === ".svg" && !isSafeSvg(args.data)) {
    throw new Error("SVG contains active content or external references");
  }

  const mimeType = ext === ".svg" ? "image/svg+xml" : args.type;

  const orgId =
    args.orgId === undefined ? getRequestOrgId() : (args.orgId ?? undefined);
  const result = await runWithRequestContext(
    { userEmail: args.email, ...(orgId === undefined ? {} : { orgId }) },
    () =>
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

  const asset: UploadedAsset = {
    url: result.url,
    filename: args.originalName,
    type: mimeType || "application/octet-stream",
    size: args.data.length,
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

export async function uploadVideoAsset(args: {
  email: string;
  orgId?: string | null;
  originalName: string;
  data: Uint8Array;
}): Promise<UploadedAsset> {
  if (args.data.length > MAX_VIDEO_ASSET_FILE_SIZE) {
    throw new Error("Video too large (max 50 MB)");
  }
  if (!canSaveAsUploadedVideoAsset(args)) {
    throw new Error("Only valid MP4 and WebM videos are allowed");
  }

  const ext = path.extname(args.originalName).toLowerCase();
  const mimeType = ext === ".mp4" ? "video/mp4" : "video/webm";
  const orgId =
    args.orgId === undefined ? getRequestOrgId() : (args.orgId ?? undefined);
  const result = await runWithRequestContext(
    { userEmail: args.email, ...(orgId === undefined ? {} : { orgId }) },
    () =>
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

  const asset: UploadedAsset = {
    url: result.url,
    filename: args.originalName,
    type: mimeType,
    size: args.data.length,
    provider: result.provider,
  };

  await getDb()
    .insert(schema.uploadedAssets)
    .values({
      id: nanoid(),
      filename: asset.filename,
      url: asset.url,
      type: asset.type,
      size: asset.size,
      provider: asset.provider ?? null,
      ownerEmail: args.email,
      createdAt: new Date().toISOString(),
    });

  return asset;
}

export const uploadVideoAssetHandler = defineEventHandler(async (event) => {
  const { session, error: authError } = await requireSession(event);
  if (!session) {
    return { error: authError };
  }

  await assertBodySize(event, MAX_VIDEO_ASSET_REQUEST_SIZE);
  const parts = await readMultipartFormData(event);
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
    const status = (error as { statusCode?: number })?.statusCode ?? 400;
    setResponseStatus(event, status);
    return {
      error: error instanceof Error ? error.message : "Video upload failed",
    };
  }
});

export const uploadAsset = defineEventHandler(async (event) => {
  const { session, error: authError } = await requireSession(event);
  if (!session) {
    return { error: authError };
  }

  await assertBodySize(event, MAX_ASSET_REQUEST_SIZE);
  const parts = await readMultipartFormData(event);
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
      ),
    );
  return { success: true };
});
