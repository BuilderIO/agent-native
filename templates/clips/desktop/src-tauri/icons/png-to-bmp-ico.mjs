#!/usr/bin/env node
// Converts an ICO file's PNG-compressed entries to BMP/DIB-encoded entries.
//
// The Windows Resource Compiler (rc.exe v10.0.10011 shipped with Windows Server)
// rejects ICO files that contain PNG-compressed images. Tauri v2 CLI generates
// PNG-compressed ICO by default. This script re-encodes all entries as BMP (DIB)
// which every version of RC.EXE supports.
//
// Uses only Node.js built-ins (fs, zlib) — no npm packages needed.
//
// Usage:
//   node png-to-bmp-ico.mjs [input.ico] [output.ico]
//   Defaults to icon.ico in the same directory (in-place).

import { readFileSync, writeFileSync } from "fs";
import { inflateSync } from "zlib";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const inputPath = resolve(process.argv[2] ?? `${__dirname}/icon.ico`);
const outputPath = resolve(process.argv[3] ?? inputPath);

// ─── Paeth predictor (PNG spec) ──────────────────────────────────────────────

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// ─── Minimal PNG decoder (8-bit RGB and RGBA only) ───────────────────────────

function decodePNG(buf) {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!SIG.every((b, i) => buf[i] === b)) throw new Error("Not a PNG");

  let width, height, colorType;
  const idatParts = [];
  let pos = 8;

  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString("ascii");
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bd = data[8];
      colorType = data[9];
      if (bd !== 8) throw new Error(`Bit depth ${bd} not supported (need 8)`);
      if (colorType !== 2 && colorType !== 6)
        throw new Error(
          `Color type ${colorType} not supported (need 2=RGB or 6=RGBA)`,
        );
    } else if (type === "IDAT") {
      idatParts.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
  }

  if (!width || !height) throw new Error("Missing IHDR");

  const bpp = colorType === 6 ? 4 : 3; // bytes per input pixel
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idatParts));

  // prev holds the previously decoded scanline (same bpp as input)
  let prev = Buffer.alloc(stride, 0);

  // Output: RGBA, top-down
  const rgba = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const lineRaw = raw.subarray(
      y * (stride + 1) + 1,
      y * (stride + 1) + 1 + stride,
    );
    const line = Buffer.alloc(stride);

    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      switch (filter) {
        case 0:
          line[i] = lineRaw[i];
          break;
        case 1:
          line[i] = (lineRaw[i] + a) & 0xff;
          break;
        case 2:
          line[i] = (lineRaw[i] + b) & 0xff;
          break;
        case 3:
          line[i] = (lineRaw[i] + ((a + b) >>> 1)) & 0xff;
          break;
        case 4:
          line[i] = (lineRaw[i] + paeth(a, b, c)) & 0xff;
          break;
        default:
          throw new Error(`Unknown filter ${filter}`);
      }
    }

    // Convert to RGBA
    const base = y * width * 4;
    for (let x = 0; x < width; x++) {
      rgba[base + x * 4] = line[x * bpp]; // R
      rgba[base + x * 4 + 1] = line[x * bpp + 1]; // G
      rgba[base + x * 4 + 2] = line[x * bpp + 2]; // B
      rgba[base + x * 4 + 3] = bpp === 4 ? line[x * bpp + 3] : 255; // A
    }

    prev = line;
  }

  return { width, height, rgba };
}

// ─── BMP DIB encoder ─────────────────────────────────────────────────────────

function encodeDIB(width, height, rgba) {
  // ICO stores a DIB (no BITMAPFILEHEADER).
  // Rows are bottom-up, channels are BGRA.
  // biHeight is 2× the image height to account for the 1-bpp AND mask.
  const andRowBytes = Math.ceil(width / 32) * 4; // rows must be DWORD-aligned
  const pixelBytes = width * height * 4;
  const andBytes = andRowBytes * height;
  const dib = Buffer.alloc(40 + pixelBytes + andBytes, 0);

  // BITMAPINFOHEADER
  dib.writeUInt32LE(40, 0); // biSize
  dib.writeInt32LE(width, 4); // biWidth
  dib.writeInt32LE(height * 2, 8); // biHeight (×2 for AND mask)
  dib.writeUInt16LE(1, 12); // biPlanes
  dib.writeUInt16LE(32, 14); // biBitCount
  // biCompression=0, biSizeImage=0, rest=0  (already zeroed)

  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y; // flip: BMP is bottom-up
    for (let x = 0; x < width; x++) {
      const src = (srcY * width + x) * 4;
      const dst = 40 + (y * width + x) * 4;
      dib[dst] = rgba[src + 2]; // B
      dib[dst + 1] = rgba[src + 1]; // G
      dib[dst + 2] = rgba[src]; // R
      dib[dst + 3] = rgba[src + 3]; // A
    }
  }
  // AND mask is all zeros = fully visible (already zeroed)
  return dib;
}

// ─── ICO parser ──────────────────────────────────────────────────────────────

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function parseICO(buf) {
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1)
    throw new Error("Not a valid ICO file");

  const count = buf.readUInt16LE(4);
  const entries = [];

  for (let i = 0; i < count; i++) {
    const base = 6 + i * 16;
    const w = buf[base] === 0 ? 256 : buf[base];
    const h = buf[base + 1] === 0 ? 256 : buf[base + 1];
    const size = buf.readUInt32LE(base + 8);
    const off = buf.readUInt32LE(base + 12);
    const data = buf.subarray(off, off + size);
    const isPNG = PNG_SIG.every((b, j) => data[j] === b);
    entries.push({ w, h, data, isPNG });
  }
  return entries;
}

// ─── ICO builder ─────────────────────────────────────────────────────────────

function buildICO(images) {
  const hdr = 6;
  const dir = images.length * 16;
  const total = hdr + dir + images.reduce((s, m) => s + m.dib.length, 0);
  const out = Buffer.alloc(total);

  out.writeUInt16LE(0, 0);
  out.writeUInt16LE(1, 2);
  out.writeUInt16LE(images.length, 4);

  let dp = 6;
  let ip = hdr + dir;

  for (const img of images) {
    out[dp] = img.w === 256 ? 0 : img.w;
    out[dp + 1] = img.h === 256 ? 0 : img.h;
    out[dp + 2] = 0;
    out[dp + 3] = 0;
    out.writeUInt16LE(1, dp + 4);
    out.writeUInt16LE(32, dp + 6);
    out.writeUInt32LE(img.dib.length, dp + 8);
    out.writeUInt32LE(ip, dp + 12);
    img.dib.copy(out, ip);
    ip += img.dib.length;
    dp += 16;
  }
  return out;
}

// ─── Main ────────────────────────────────────────────────────────────────────

console.log(`Input : ${inputPath}`);
console.log(`Output: ${outputPath}\n`);

const raw = readFileSync(inputPath);

// Sanity-check: reject a bare PNG passed as input
if (PNG_SIG.every((b, i) => raw[i] === b)) {
  console.error("Input is a raw PNG, not an ICO file.");
  console.error(
    "Run `pnpm tauri icon src-tauri/icons/icon.png` first to generate icon.ico,",
  );
  console.error("then re-run this script.");
  process.exit(1);
}

const entries = parseICO(raw);
console.log(`Found ${entries.length} ICO entries:`);

const images = [];
for (const entry of entries) {
  const label = entry.isPNG
    ? "PNG  →  converting to BMP"
    : "BMP  (keeping as-is)";
  process.stdout.write(
    `  ${String(entry.w).padStart(3)}x${entry.h}  ${label} … `,
  );

  if (entry.isPNG) {
    try {
      const { width, height, rgba } = decodePNG(entry.data);
      const dib = encodeDIB(width, height, rgba);
      images.push({ w: width, h: height, dib });
      console.log(`done (${dib.length} bytes DIB)`);
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      // Skip this entry rather than aborting; log a warning.
      console.warn(`  ⚠ Skipping ${entry.w}x${entry.h}: ${err.message}`);
    }
  } else {
    images.push({ w: entry.w, h: entry.h, dib: Buffer.from(entry.data) });
    console.log(`(${entry.data.length} bytes DIB)`);
  }
}

if (images.length === 0) {
  console.error("\nNo images remain after conversion. Aborting.");
  process.exit(1);
}

const ico = buildICO(images);
writeFileSync(outputPath, ico);

console.log(
  `\n✓ Wrote BMP-only ICO: ${images.length} images, ${ico.length} bytes`,
);
