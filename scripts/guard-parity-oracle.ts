#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

import { requireAddedLines } from "./lib/changed-lines.mjs";

const GUARD_NAME = "guard:parity-oracle";
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const requireCore = createRequire(
  path.join(REPO_ROOT, "packages/core/package.json"),
);
const ORACLE_DIR = "templates/design/parity/oracle";
const MAX_ENTRY_BYTES = 64 * 1024;
const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
const MAX_LEDGER_ARTIFACT_BYTES = 50 * 1024 * 1024;
const MAX_DECOMPRESSED_PNG_BYTES = 128 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 32 * 1024 * 1024;
const JPEG_DECODER_UNAVAILABLE = "JPEG_DECODER_UNAVAILABLE";
const INVALID_IMAGE_DATA = "INVALID_IMAGE_DATA";
const WITHHELD_FIGMA_PAGE_NAME =
  "not captured; private scratch page name withheld";
const ORACLE_ID = /^fig\.[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HASH = /^[a-f0-9]{64}$/;
const TEST_FILE = /\.(?:spec|test)\.[cm]?[jt]sx?$/i;
const ARTIFACT_KINDS = new Set([
  "figma-screenshot",
  "design-screenshot",
  "comparison-sheet",
]);
const TEST_BLOCK =
  /(?<![\w$.])(?:test|it)(?:\.(?:only|skip|fixme|each|concurrent))*\s*(?:<[^>\n]+>\s*)?(?:`[\s\S]*?`\s*)?\(/g;
const ORACLE_CALL = /\boracle\s*\(\s*["'](fig\.[a-z0-9.-]+)["']\s*\)/g;
const ORACLE_COMMENT =
  /\boracle\s*:\s*(fig\.[a-z0-9.-]+|none\s*[—-]\s*\S[^\r\n]*)/i;
const INVENTED_DOC =
  /(?:figma-ground-truth\.md|Figma\s+spec\s*§|ground-truth\s+Round\s+\d+|Steve(?:'s)?\s+ground truth)/i;

type SharpFactory = (
  input: Buffer,
  options: {
    failOn: "warning";
    limitInputPixels: number;
    sequentialRead: true;
  },
) => {
  resize(options: {
    width: number;
    height: number;
    fit: "inside";
    withoutEnlargement: true;
  }): { raw(): { toBuffer(): Promise<Buffer> } };
};

type JpegDecoderLoader = () => SharpFactory;

function requireJpegDecoder(
  load: JpegDecoderLoader = () => requireCore("sharp") as SharpFactory,
): SharpFactory {
  try {
    return load();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(`JPEG decoder unavailable: ${detail}`), {
      code: JPEG_DECODER_UNAVAILABLE,
    });
  }
}

function jpegHasEntropyData(bytes: Buffer): boolean {
  let offset = 2;
  while (offset + 4 <= bytes.length - 2) {
    if (bytes[offset] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++]!;
    if (marker === 0xda) {
      const segmentLength = bytes.readUInt16BE(offset);
      if (segmentLength < 6 || offset + segmentLength > bytes.length - 2)
        return false;
      let scanOffset = offset + segmentLength;
      while (scanOffset < bytes.length - 2) {
        if (bytes[scanOffset] !== 0xff) return true;
        const next = bytes[scanOffset + 1]!;
        if (next === 0x00) return true;
        if (next >= 0xd0 && next <= 0xd7) {
          scanOffset += 2;
          continue;
        }
        return false;
      }
      return false;
    }
    if (marker === 0xd9) return false;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length - 2)
      return false;
    offset += segmentLength;
  }
  return false;
}

export type OracleBasis = "measured" | "chosen";
export type OracleStatus = "current" | "retracted" | "repeat-required";

export type OracleArtifact = {
  path: string;
  kind: string;
  sha256: string;
  sourceName?: string;
  sourceSha256?: string;
  crop?: string;
};

export type OracleEntry = {
  schemaVersion: 1;
  id: string;
  claim: string;
  area: string;
  basis: OracleBasis;
  status: OracleStatus;
  measuredBy?: string;
  operator?: string;
  date: string;
  gesture?: string;
  nativeObservation?: string;
  trials?: string;
  values?: Record<string, unknown>;
  figma?: Record<string, unknown>;
  source?: string;
  artifacts: OracleArtifact[];
  retractionReason?: string;
  repeatReason?: string;
  supersededBy?: string;
  decidedBy?: string;
  reason?: string;
  figmaBehavior?: string;
};

export type GuardResult = {
  exitCode: 0 | 1 | 2;
  message: string;
};

type Ledger = {
  entries: Map<string, OracleEntry>;
  entryCount: number;
  problems: string[];
  inspectionError?: string;
  artifactBytes: number;
};

export type AddedLines = Map<string, Set<number>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function containsPrivateFigmaLocator(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPrivateFigmaLocator);
  if (typeof value === "string") {
    return /https?:\/\/(?:www\.)?figma\.com\/(?:file|design|proto|board|slides|deck)\/[^/?#\s]+/i.test(
      value,
    );
  }
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => {
    const normalizedKey = key.replace(/[^a-z]/gi, "").toLowerCase();
    return (
      normalizedKey === "filekey" ||
      normalizedKey === "figmafilekey" ||
      normalizedKey === "pageid" ||
      normalizedKey === "figmapageid" ||
      containsPrivateFigmaLocator(child)
    );
  });
}

async function imageFormat(
  bytes: Buffer,
  jpegDecoderLoader?: JpegDecoderLoader,
): Promise<"png" | "jpeg" | null> {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length >= 45 && bytes.subarray(0, 8).equals(pngSignature)) {
    let offset = 8;
    let sawHeader = false;
    let sawPalette = false;
    let sawData = false;
    let endedData = false;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = -1;
    let interlace = -1;
    let paletteEntries = 0;
    const compressed: Buffer[] = [];
    while (offset + 12 <= bytes.length) {
      const size = bytes.readUInt32BE(offset);
      const type = bytes.toString("ascii", offset + 4, offset + 8);
      const end = offset + 12 + size;
      if (end > bytes.length) return null;
      const typeBytes = bytes.subarray(offset + 4, offset + 8);
      const chunkData = bytes.subarray(offset + 8, offset + 8 + size);
      if (
        !/^[A-Za-z]{4}$/.test(type) ||
        pngCrc32(bytes.subarray(offset + 4, offset + 8 + size)) !==
          bytes.readUInt32BE(offset + 8 + size)
      ) {
        return null;
      }
      if (!sawHeader) {
        if (type !== "IHDR" || size !== 13) return null;
        width = chunkData.readUInt32BE(0);
        height = chunkData.readUInt32BE(4);
        bitDepth = chunkData[8];
        colorType = chunkData[9];
        interlace = chunkData[12];
        if (
          width === 0 ||
          height === 0 ||
          width * height > MAX_IMAGE_PIXELS ||
          !validPngBitDepth(colorType, bitDepth) ||
          chunkData[10] !== 0 ||
          chunkData[11] !== 0 ||
          (interlace !== 0 && interlace !== 1)
        ) {
          return null;
        }
        sawHeader = true;
      } else if (type === "IHDR") {
        return null;
      }
      if (
        typeBytes[0]! >= 65 &&
        typeBytes[0]! <= 90 &&
        !["IHDR", "PLTE", "IDAT", "IEND"].includes(type)
      ) {
        return null;
      }
      if (type === "PLTE") {
        if (
          sawPalette ||
          sawData ||
          size === 0 ||
          size % 3 !== 0 ||
          size > 768 ||
          colorType === 0 ||
          colorType === 4
        ) {
          return null;
        }
        sawPalette = true;
        paletteEntries = size / 3;
      }
      if (type === "IDAT") {
        if (endedData || (colorType === 3 && !sawPalette)) return null;
        sawData = true;
        compressed.push(chunkData);
      } else if (sawData && type !== "IEND") {
        endedData = true;
      }
      if (type === "IEND") {
        if (!sawHeader || !sawData || size !== 0 || end !== bytes.length)
          return null;
        if (colorType === 3 && paletteEntries > 2 ** bitDepth) return null;
        return validPngPixels(
          Buffer.concat(compressed),
          width,
          height,
          bitDepth,
          colorType,
          interlace,
        )
          ? "png"
          : null;
      }
      offset = end;
    }
    return null;
  }

  if (
    bytes.length < 16 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  ) {
    return null;
  }
  if (!jpegHasEntropyData(bytes)) return null;
  const sharp = requireJpegDecoder(jpegDecoderLoader);
  try {
    await sharp(bytes, {
      failOn: "warning",
      limitInputPixels: MAX_IMAGE_PIXELS,
      sequentialRead: true,
    })
      .resize({ width: 1, height: 1, fit: "inside", withoutEnlargement: true })
      .raw()
      .toBuffer();
    return "jpeg";
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw Object.assign(new Error(`JPEG image data is invalid: ${detail}`), {
      code: INVALID_IMAGE_DATA,
      cause: error,
    });
  }
}

function pngCrc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validPngBitDepth(colorType: number, bitDepth: number): boolean {
  const allowed: Record<number, number[]> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  return allowed[colorType]?.includes(bitDepth) ?? false;
}

function validPngPixels(
  compressed: Buffer,
  width: number,
  height: number,
  bitDepth: number,
  colorType: number,
  interlace: number,
): boolean {
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const bitsPerPixel = channels[colorType]! * bitDepth;
  const passes =
    interlace === 0
      ? [[0, 0, 1, 1]]
      : [
          [0, 0, 8, 8],
          [4, 0, 8, 8],
          [0, 4, 4, 8],
          [2, 0, 4, 4],
          [0, 2, 2, 4],
          [1, 0, 2, 2],
          [0, 1, 1, 2],
        ];
  let expectedLength = 0;
  const passRows: Array<{ rowBytes: number; height: number }> = [];
  for (const [xStart, yStart, xStep, yStep] of passes) {
    const passWidth =
      width <= xStart! ? 0 : Math.ceil((width - xStart!) / xStep!);
    const passHeight =
      height <= yStart! ? 0 : Math.ceil((height - yStart!) / yStep!);
    if (passWidth === 0 || passHeight === 0) continue;
    const rowBytes = Math.ceil((passWidth * bitsPerPixel) / 8);
    expectedLength += passHeight * (rowBytes + 1);
    if (expectedLength > MAX_DECOMPRESSED_PNG_BYTES) return false;
    passRows.push({ rowBytes, height: passHeight });
  }
  if (expectedLength === 0) return false;
  try {
    const pixels = inflateSync(compressed, {
      maxOutputLength: MAX_DECOMPRESSED_PNG_BYTES,
    });
    if (pixels.length !== expectedLength) return false;
    let offset = 0;
    for (const pass of passRows) {
      for (let row = 0; row < pass.height; row += 1) {
        if (pixels[offset]! > 4) return false;
        offset += pass.rowBytes + 1;
      }
    }
    return offset === pixels.length;
  } catch {
    // coercion-ok: Zlib decode and output-limit failures mean the PNG is invalid.
    return false;
  }
}

function inside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return (
    rel !== "" &&
    rel !== ".." &&
    !rel.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(rel)
  );
}

function readEntryFile(file: string): unknown {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw Object.assign(new Error("entry must be a regular file"), {
      code: "INVALID_ENTRY_FILE",
    });
  }
  if (stat.size > MAX_ENTRY_BYTES) {
    throw Object.assign(new Error(`entry exceeds ${MAX_ENTRY_BYTES} bytes`), {
      code: "INVALID_ENTRY_FILE",
    });
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

function artifactPath(
  root: string,
  id: string,
  artifactPathValue: string,
): string | null {
  if (
    artifactPathValue.includes("\\") ||
    path.posix.isAbsolute(artifactPathValue) ||
    artifactPathValue
      .split("/")
      .some((segment) => segment === ".." || segment === ".") ||
    !artifactPathValue.startsWith(`${ORACLE_DIR}/${id}/`)
  ) {
    return null;
  }
  const absolute = path.resolve(root, artifactPathValue);
  const entryRoot = path.resolve(root, ORACLE_DIR, id);
  return inside(entryRoot, absolute) ? absolute : null;
}

function checkNoSymlinkPath(root: string, target: string): void {
  let cursor = root;
  for (const part of path.relative(root, target).split(path.sep)) {
    cursor = path.join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink()) {
      throw Object.assign(
        new Error(`symlink path component: ${path.relative(root, cursor)}`),
        {
          code: "INVALID_ARTIFACT_PATH",
        },
      );
    }
  }
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

async function loadLedger(
  root: string,
  today: Date,
  jpegDecoderLoader?: JpegDecoderLoader,
): Promise<Ledger> {
  const entries = new Map<string, OracleEntry>();
  const problems: string[] = [];
  let artifactBytes = 0;
  const dir = path.join(root, ORACLE_DIR);
  let files: string[];
  try {
    files = readdirSync(dir, { withFileTypes: true })
      .map((item) => {
        if (item.isSymbolicLink()) {
          problems.push(
            `${ORACLE_DIR}/${item.name}: symlink entries are not allowed`,
          );
          return null;
        }
        return item.isFile() && item.name.endsWith(".json") ? item.name : null;
      })
      .filter((name): name is string => name !== null)
      .sort();
  } catch (error) {
    const code =
      isRecord(error) && typeof error.code === "string" ? error.code : "";
    if (code === "ENOENT") {
      return {
        entries,
        entryCount: 0,
        problems,
        artifactBytes,
      };
    }
    const detail = error instanceof Error ? error.message : String(error);
    return {
      entries,
      entryCount: 0,
      problems,
      artifactBytes,
      inspectionError: `cannot read ${ORACLE_DIR}: ${detail}`,
    };
  }

  for (const filename of files) {
    const fullPath = path.join(dir, filename);
    const expectedId = filename.slice(0, -".json".length);
    let raw: unknown;
    try {
      raw = readEntryFile(fullPath);
    } catch (error) {
      const code =
        isRecord(error) && typeof error.code === "string" ? error.code : "";
      const detail = error instanceof Error ? error.message : String(error);
      if (code && code !== "INVALID_ENTRY_FILE" && code !== "SyntaxError") {
        return {
          entries,
          entryCount: entries.size,
          problems,
          artifactBytes,
          inspectionError: `cannot inspect ${ORACLE_DIR}/${filename}: ${detail}`,
        };
      }
      problems.push(`${ORACLE_DIR}/${filename}: ${detail}`);
      continue;
    }
    if (!isRecord(raw)) {
      problems.push(`${ORACLE_DIR}/${filename}: entry must be a JSON object`);
      continue;
    }

    const entry = raw as unknown as OracleEntry;
    const label = `${ORACLE_DIR}/${filename}`;
    if (!ORACLE_ID.test(entry.id ?? ""))
      problems.push(`${label}: invalid fig.* id`);
    if (entry.id !== expectedId)
      problems.push(`${label}: id must match the filename`);
    if (entries.has(entry.id))
      problems.push(`${label}: duplicate id ${entry.id}`);
    if (entry.schemaVersion !== 1)
      problems.push(`${label}: schemaVersion must be 1`);
    if (!nonempty(entry.claim) || !nonempty(entry.area))
      problems.push(`${label}: claim and area are required`);
    if (entry.basis !== "measured" && entry.basis !== "chosen")
      problems.push(`${label}: basis must be measured or chosen`);
    if (!["current", "retracted", "repeat-required"].includes(entry.status))
      problems.push(`${label}: invalid status`);
    if (!isDate(entry.date) || new Date(`${entry.date}T00:00:00.000Z`) > today)
      problems.push(`${label}: date must be a valid non-future ISO date`);
    if (entry.status === "retracted" && !nonempty(entry.retractionReason))
      problems.push(`${label}: retracted entries need retractionReason`);
    if (entry.status === "repeat-required" && !nonempty(entry.repeatReason))
      problems.push(`${label}: repeat-required entries need repeatReason`);
    if (containsPrivateFigmaLocator(entry))
      problems.push(`${label}: private Figma locator must not be committed`);
    if (isRecord(entry.figma)) {
      if (
        entry.figma.pageName !== undefined &&
        entry.figma.pageName !== WITHHELD_FIGMA_PAGE_NAME
      ) {
        problems.push(
          `${label}: figma.pageName must use the withheld placeholder`,
        );
      }
    }
    if (!Array.isArray(entry.artifacts)) {
      problems.push(`${label}: artifacts must be an array`);
    } else {
      let hasMeasuredFigmaScreenshot = false;
      for (const artifact of entry.artifacts) {
        if (!isRecord(artifact)) {
          problems.push(`${label}: artifact must be an object`);
          continue;
        }
        const relPath = artifact.path;
        if (!nonempty(relPath)) {
          problems.push(`${label}: artifact path is required`);
          continue;
        }
        if (!nonempty(artifact.kind) || !ARTIFACT_KINDS.has(artifact.kind)) {
          problems.push(`${label}: unsupported artifact kind`);
        }
        if (!HASH.test(String(artifact.sha256 ?? ""))) {
          problems.push(`${label}: artifact kind and sha256 are required`);
        }
        if (
          artifact.sourceSha256 !== undefined &&
          !HASH.test(String(artifact.sourceSha256))
        ) {
          problems.push(`${label}: sourceSha256 must be a SHA-256 digest`);
        }
        if (
          artifact.sourceName !== undefined &&
          !nonempty(artifact.sourceName)
        ) {
          problems.push(`${label}: sourceName must be nonempty when provided`);
        }
        if (artifact.crop !== undefined && !nonempty(artifact.crop)) {
          problems.push(`${label}: crop must be nonempty when provided`);
        }
        const target = artifactPath(root, entry.id, relPath);
        if (!target) {
          problems.push(
            `${label}: artifact path must stay under its entry directory`,
          );
          continue;
        }
        try {
          checkNoSymlinkPath(root, target);
          const stat = lstatSync(target);
          if (!stat.isFile()) {
            problems.push(
              `${label}: artifact ${relPath} must be a regular file`,
            );
            continue;
          }
          if (stat.size === 0 || stat.size > MAX_ARTIFACT_BYTES) {
            problems.push(
              `${label}: artifact ${relPath} is empty or exceeds ${MAX_ARTIFACT_BYTES} bytes`,
            );
            continue;
          }
          artifactBytes += stat.size;
          const bytes = readFileSync(target);
          const format = await imageFormat(bytes, jpegDecoderLoader);
          if (!format) {
            problems.push(
              `${label}: artifact ${relPath} is not a valid PNG or JPEG image`,
            );
          } else if (artifact.kind === "figma-screenshot" && format !== null) {
            hasMeasuredFigmaScreenshot = true;
          }
          const actual = createHash("sha256").update(bytes).digest("hex");
          if (actual !== artifact.sha256)
            problems.push(`${label}: sha256 mismatch for ${relPath}`);
        } catch (error) {
          const code =
            isRecord(error) && typeof error.code === "string" ? error.code : "";
          const detail = error instanceof Error ? error.message : String(error);
          if (code === INVALID_IMAGE_DATA) {
            problems.push(
              `${label}: artifact ${relPath} is not a valid PNG or JPEG image`,
            );
          } else if (code === "ENOENT" || code === "INVALID_ARTIFACT_PATH") {
            problems.push(
              `${label}: artifact ${relPath} is missing or unsafe (${detail})`,
            );
          } else {
            return {
              entries,
              entryCount: entries.size,
              problems,
              artifactBytes,
              inspectionError: `cannot inspect ${relPath}: ${detail}`,
            };
          }
        }
      }
      if (entry.basis === "measured" && !hasMeasuredFigmaScreenshot)
        problems.push(
          `${label}: measured entries need a valid figma-screenshot artifact`,
        );
    }
    if (entry.basis === "measured") {
      for (const [field, value] of Object.entries({
        measuredBy: entry.measuredBy,
        operator: entry.operator,
        gesture: entry.gesture,
        nativeObservation: entry.nativeObservation,
        trials: entry.trials,
        source: entry.source,
      })) {
        if (!nonempty(value))
          problems.push(`${label}: measured entries need ${field}`);
      }
      if (!isRecord(entry.values) || Object.keys(entry.values).length === 0)
        problems.push(`${label}: measured entries need values`);
      if (
        !isRecord(entry.figma) ||
        entry.figma.fileKeyWithheld !== true ||
        entry.figma.pageName !== WITHHELD_FIGMA_PAGE_NAME
      ) {
        problems.push(
          `${label}: measured entries need a withheld page name and fileKeyWithheld=true`,
        );
      }
    } else if (
      !nonempty(entry.decidedBy) ||
      !nonempty(entry.reason) ||
      !(
        entry.figmaBehavior === "unmeasured" ||
        (typeof entry.figmaBehavior === "string" &&
          ORACLE_ID.test(entry.figmaBehavior))
      )
    ) {
      problems.push(
        `${label}: chosen entries need decidedBy, reason, and figmaBehavior`,
      );
    }
    entries.set(entry.id, entry);
  }

  if (artifactBytes > MAX_LEDGER_ARTIFACT_BYTES) {
    problems.push(
      `${ORACLE_DIR}: artifacts exceed total size cap of ${MAX_LEDGER_ARTIFACT_BYTES} bytes`,
    );
  }
  return { entries, entryCount: files.length, problems, artifactBytes };
}

function lineNumber(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

function citationProblem(
  rel: string,
  line: number,
  id: string,
  entries: Map<string, OracleEntry>,
): string | null {
  const entry = entries.get(id);
  if (!entry) return `${rel}:${line}: unknown oracle id ${id}`;
  if (entry.status === "retracted")
    return `${rel}:${line}: oracle ${id} is retracted`;
  if (entry.status === "repeat-required")
    return `${rel}:${line}: oracle ${id} requires a repeat`;
  if (entry.basis !== "measured")
    return `${rel}:${line}: oracle ${id} is chosen, not measured evidence`;
  return null;
}

function validateAllCitations(
  root: string,
  entries: Map<string, OracleEntry>,
): { problems: string[]; inspectionError?: string } {
  const problems: string[] = [];
  const files: string[] = [];
  const ignoredDirectories = new Set([
    "build",
    "coverage",
    "dist",
    "node_modules",
    ".next",
  ]);

  const visit = (directory: string): string | undefined => {
    let items;
    try {
      items = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      const code =
        isRecord(error) && typeof error.code === "string" ? error.code : "";
      if (code === "ENOENT") return undefined;
      const detail = error instanceof Error ? error.message : String(error);
      return `cannot read ${path.relative(root, directory)}: ${detail}`;
    }
    for (const item of items) {
      const absolute = path.join(directory, item.name);
      if (item.isSymbolicLink()) {
        return `cannot inspect symlink ${path.relative(root, absolute)}`;
      }
      if (item.isDirectory()) {
        if (ignoredDirectories.has(item.name)) continue;
        const error = visit(absolute);
        if (error) return error;
      } else if (item.isFile() && TEST_FILE.test(item.name)) {
        files.push(absolute);
      }
    }
    return undefined;
  };

  for (const relative of ["templates/design/e2e", "templates/design/app"]) {
    const error = visit(path.join(root, relative));
    if (error) return { problems, inspectionError: error };
  }

  for (const absolute of files) {
    const rel = path.relative(root, absolute).replace(/\\/g, "/");
    let source: string;
    try {
      source = readFileSync(absolute, "utf8");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        problems,
        inspectionError: `cannot read citation source ${rel}: ${detail}`,
      };
    }
    const references = [
      ...source.matchAll(/\boracle\s*:\s*(fig\.[a-z0-9.-]+)/gi),
      ...source.matchAll(ORACLE_CALL),
    ];
    for (const match of references) {
      const problem = citationProblem(
        rel,
        lineNumber(source, match.index ?? 0),
        match[1],
        entries,
      );
      if (problem) problems.push(problem);
    }
  }
  return { problems };
}

function precedingOracleComment(
  source: string,
  offset: number,
): { text: string; start: number } | null {
  const prefix = source.slice(0, offset);
  const lines = prefix.split("\n");
  const comments: string[] = [];
  let cursor = offset;
  let start: number | null = null;
  for (
    let index = lines.length - 1;
    index >= Math.max(0, lines.length - 7);
    index -= 1
  ) {
    const trimmed = lines[index].trim();
    const lineStart = prefix.lastIndexOf("\n", cursor - 1) + 1;
    if (trimmed === "") {
      cursor = lineStart - 1;
      continue;
    }
    if (
      !trimmed.startsWith("//") &&
      !trimmed.startsWith("*") &&
      !trimmed.startsWith("/*")
    )
      break;
    comments.unshift(trimmed);
    start = lineStart;
    cursor = lineStart - 1;
  }
  return start === null ? null : { text: comments.join("\n"), start };
}

function validateAddedTests(
  root: string,
  added: AddedLines,
  entries: Map<string, OracleEntry>,
): { citations: number; problems: string[]; inspectionError?: string } {
  const problems: string[] = [];
  let citations = 0;
  for (const [absolutePath, changed] of added) {
    const rel = path.relative(root, absolutePath).replace(/\\/g, "/");
    if (!/^templates\/design\/(?:e2e|app)\//.test(rel)) continue;
    let source: string;
    try {
      source = readFileSync(absolutePath, "utf8");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        citations,
        problems,
        inspectionError: `cannot read changed file ${rel}: ${detail}`,
      };
    }
    const lines = source.split("\n");
    const lineOffsets = new Map<number, number>();
    let lineOffset = 0;
    for (const [index, line] of lines.entries()) {
      lineOffsets.set(index + 1, lineOffset);
      lineOffset += line.length + 1;
    }
    for (const line of changed) {
      const text = lines[line - 1];
      if (text === undefined)
        return {
          citations,
          problems,
          inspectionError: `changed line ${rel}:${line} is unavailable`,
        };
      if (INVENTED_DOC.test(text))
        problems.push(
          `${rel}:${line}: cites a nonexistent Figma oracle document`,
        );
      for (const match of text.matchAll(
        /\boracle\s*:\s*(fig\.[a-z0-9.-]+)/gi,
      )) {
        const problem = citationProblem(rel, line, match[1], entries);
        if (problem) problems.push(problem);
      }
      for (const match of text.matchAll(ORACLE_CALL)) {
        const problem = citationProblem(rel, line, match[1], entries);
        if (problem) problems.push(problem);
      }
    }
    if (!/^templates\/design\/(?:e2e|app)\//.test(rel) || !TEST_FILE.test(rel))
      continue;

    const matches = [...source.matchAll(TEST_BLOCK)];
    for (let index = 0; index < matches.length; index += 1) {
      const start = matches[index].index ?? 0;
      const nextStart = matches[index + 1]?.index;
      let end = nextStart ?? source.length;
      if (nextStart !== undefined) {
        const nextComment = precedingOracleComment(source, nextStart);
        if (nextComment?.text.match(ORACLE_COMMENT)) end = nextComment.start;
      }
      const startLine = lineNumber(source, start);
      const changedInBlock = [...changed].some((number) => {
        const lineStart = lineOffsets.get(number);
        if (lineStart === undefined) return false;
        const lineEnd = lineOffsets.get(number + 1) ?? source.length;
        return lineStart < end && lineEnd > start;
      });
      if (!changedInBlock) continue;
      const body = source.slice(start, end);
      const relName = path.posix.basename(rel);
      const parityClaim =
        rel.startsWith("templates/design/e2e/") ||
        /(?:parity|oracle)/i.test(relName) ||
        /\b(?:Figma|figma|parity|matches\s+(?:the\s+)?native)\b/.test(body);
      if (!parityClaim) continue;

      const citation = precedingOracleComment(source, start)?.text.match(
        ORACLE_COMMENT,
      );
      const call = body.match(ORACLE_CALL);
      if (!citation && !call) {
        // The ledger and its reference material can be intentionally removed.
        // In that state there is no measured evidence to require test authors
        // to classify, while explicit references above still fail if unknown.
        if (entries.size > 0) {
          problems.push(
            `${rel}:${startLine}: test block needs oracle: fig.* or oracle: none — reason`,
          );
        }
        continue;
      }
      if (citation) {
        citations += 1;
        if (citation[1].toLowerCase().startsWith("none")) continue;
        const id = citation[1];
        const problem = citationProblem(rel, startLine, id, entries);
        if (problem) problems.push(problem);
      } else if (call) {
        citations += 1;
        const id = call[1];
        const problem = citationProblem(rel, startLine, id, entries);
        if (problem) problems.push(problem);
      }
    }
  }
  return { citations, problems };
}

export async function runParityOracleGuard(options: {
  repoRoot: string;
  addedLines: AddedLines | null;
  today?: Date;
  jpegDecoderLoader?: JpegDecoderLoader;
}): Promise<GuardResult> {
  if (options.addedLines === null) {
    return {
      exitCode: 2,
      message: `${GUARD_NAME}: could not determine added lines`,
    };
  }
  const ledger = await loadLedger(
    options.repoRoot,
    options.today ?? new Date(),
    options.jpegDecoderLoader,
  );
  if (ledger.inspectionError) {
    return { exitCode: 2, message: `${GUARD_NAME}: ${ledger.inspectionError}` };
  }
  const citationResult = validateAddedTests(
    options.repoRoot,
    options.addedLines,
    ledger.entries,
  );
  if (citationResult.inspectionError) {
    return {
      exitCode: 2,
      message: `${GUARD_NAME}: ${citationResult.inspectionError}`,
    };
  }
  const allCitations = validateAllCitations(options.repoRoot, ledger.entries);
  if (allCitations.inspectionError) {
    return {
      exitCode: 2,
      message: `${GUARD_NAME}: ${allCitations.inspectionError}`,
    };
  }
  const problems = [
    ...new Set([
      ...ledger.problems,
      ...citationResult.problems,
      ...allCitations.problems,
    ]),
  ];
  const summary = `${ledger.entryCount} ${ledger.entryCount === 1 ? "entry" : "entries"}, ${citationResult.citations} ${citationResult.citations === 1 ? "citation" : "citations"}`;
  if (problems.length > 0) {
    return {
      exitCode: 1,
      message: `${GUARD_NAME}: ${summary}; failed:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
    };
  }
  const staleIds = new Set<string>();
  for (const [absolutePath, changed] of options.addedLines) {
    let source = "";
    try {
      source = readFileSync(absolutePath, "utf8");
    } catch {
      continue;
    }
    const lines = source.split("\n");
    for (const line of changed) {
      const text = lines[line - 1] ?? "";
      for (const match of text.matchAll(/\boracle\s*:\s*(fig\.[a-z0-9.-]+)/gi))
        staleIds.add(match[1]);
      for (const match of text.matchAll(ORACLE_CALL)) staleIds.add(match[1]);
    }
  }
  const staleWarnings = [...staleIds].flatMap((id) => {
    const entry = ledger.entries.get(id);
    if (!entry || !isDate(entry.date)) return [];
    const ageMs =
      (options.today ?? new Date()).getTime() -
      new Date(`${entry.date}T00:00:00.000Z`).getTime();
    return ageMs > 180 * 24 * 60 * 60 * 1000
      ? [`stale citation ${id} (${Math.floor(ageMs / 86_400_000)} days old)`]
      : [];
  });
  return {
    exitCode: 0,
    message: `${GUARD_NAME}: ${summary}${staleWarnings.length ? `; warning: ${staleWarnings.join(", ")}` : ""}`,
  };
}

async function main(): Promise<void> {
  const added = requireAddedLines(REPO_ROOT, GUARD_NAME);
  const result = await runParityOracleGuard({
    repoRoot: REPO_ROOT,
    addedLines: added,
  });
  (result.exitCode === 0 ? console.log : console.error)(result.message);
  process.exitCode = result.exitCode;
}

if (
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
) {
  await main();
}
