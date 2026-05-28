#!/usr/bin/env node
// Strips PNG-compressed entries from an ICO file.
//
// RC.EXE v10.0.10011 (the system rc.exe shipped with Windows Server) rejects
// ICO files that contain PNG-embedded images ("not in 3.00 format" error).
// Modern icon tools embed PNG for large sizes (256x256) to reduce file size,
// but the old RC.EXE only understands BMP/DIB-encoded ICO entries.
//
// This script reads icon.ico, removes any entry whose image data starts with
// the PNG signature, and rewrites the file with only BMP entries.
//
// Usage: node strip-png-ico-entries.mjs [path/to/icon.ico]

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const icoPath = resolve(
  process.argv[2] ?? `${__dirname}/icon.ico`
);

const buf = readFileSync(icoPath);

const reserved = buf.readUInt16LE(0);
const type = buf.readUInt16LE(2);
const count = buf.readUInt16LE(4);

if (reserved !== 0 || type !== 1) {
  console.error("Not a valid ICO file (bad header)");
  process.exit(1);
}

console.log(`Parsing ICO: ${count} image(s) — ${buf.length} bytes`);

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const entries = [];
for (let i = 0; i < count; i++) {
  const dirBase = 6 + i * 16;
  const w = buf[dirBase] === 0 ? 256 : buf[dirBase];
  const h = buf[dirBase + 1] === 0 ? 256 : buf[dirBase + 1];
  const colorCount = buf[dirBase + 2];
  const planes = buf.readUInt16LE(dirBase + 4);
  const bitCount = buf.readUInt16LE(dirBase + 6);
  const size = buf.readUInt32LE(dirBase + 8);
  const dataOffset = buf.readUInt32LE(dirBase + 12);

  const isPNG = PNG_SIG.every((b, j) => buf[dataOffset + j] === b);
  const data = buf.subarray(dataOffset, dataOffset + size);

  console.log(
    `  [${i}] ${w}x${h} ${bitCount}bpp — ${isPNG ? "PNG (will remove)" : "BMP (keeping)"} — ${size} bytes`
  );

  entries.push({ w, h, colorCount, planes, bitCount, data, isPNG });
}

const kept = entries.filter((e) => !e.isPNG);
const removed = entries.length - kept.length;

if (kept.length === 0) {
  console.error("All entries are PNG-compressed — cannot produce a BMP-only ICO.");
  process.exit(1);
}

console.log(`\nKeeping ${kept.length} BMP entries, removing ${removed} PNG entries.`);

// Rebuild ICO
const headerSize = 6;
const dirSize = kept.length * 16;
const totalSize =
  headerSize + dirSize + kept.reduce((s, e) => s + e.data.length, 0);
const out = Buffer.alloc(totalSize);

out.writeUInt16LE(0, 0);
out.writeUInt16LE(1, 2);
out.writeUInt16LE(kept.length, 4);

let dirPos = 6;
let imgPos = headerSize + dirSize;
for (const entry of kept) {
  out[dirPos] = entry.w === 256 ? 0 : entry.w;
  out[dirPos + 1] = entry.h === 256 ? 0 : entry.h;
  out[dirPos + 2] = entry.colorCount;
  out[dirPos + 3] = 0;
  out.writeUInt16LE(entry.planes, dirPos + 4);
  out.writeUInt16LE(entry.bitCount, dirPos + 6);
  out.writeUInt32LE(entry.data.length, dirPos + 8);
  out.writeUInt32LE(imgPos, dirPos + 12);
  entry.data.copy(out, imgPos);
  imgPos += entry.data.length;
  dirPos += 16;
}

writeFileSync(icoPath, out);
console.log(`\nSaved BMP-only ICO to ${icoPath} (${out.length} bytes)`);
