import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { deflateSync } from "node:zlib";

const BASELINE = {
  screens: 10,
  dom: 100,
  height: 1000,
  imageMp: 0,
  imagesPerScreen: 1,
  loops: 0,
  width: 1440,
  gap: 240,
};

const { values } = parseArgs({
  options: {
    screens: { type: "string" },
    dom: { type: "string" },
    height: { type: "string" },
    "image-mp": { type: "string" },
    "images-per-screen": { type: "string" },
    loops: { type: "string" },
    out: { type: "string" },
    title: { type: "string" },
  },
});

function positive(
  name: string,
  raw: string | undefined,
  fallback: number,
  min: number,
): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min) {
    throw new Error(`--${name} must be a number >= ${min}, got ${raw}`);
  }
  return value;
}

const screens = Math.floor(
  positive("screens", values.screens, BASELINE.screens, 1),
);
const dom = Math.floor(positive("dom", values.dom, BASELINE.dom, 1));
const height = Math.floor(
  positive("height", values.height, BASELINE.height, 100),
);
const imageMp = positive("image-mp", values["image-mp"], BASELINE.imageMp, 0);
const imagesPerScreen = Math.floor(
  positive(
    "images-per-screen",
    values["images-per-screen"],
    BASELINE.imagesPerScreen,
    1,
  ),
);
const loops = Math.floor(positive("loops", values.loops, BASELINE.loops, 0));
const out = values.out;
if (!out) throw new Error("--out is required");

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function makePng(megapixels: number): {
  data: Buffer;
  width: number;
  height: number;
} {
  const pixels = Math.round(megapixels * 1_000_000);
  const width = Math.round(Math.sqrt((pixels * 4) / 3));
  const rows = Math.max(1, Math.round(pixels / width));
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * rows);
  for (let y = 0; y < rows; y += 1) {
    const base = y * stride;
    raw[base] = 0;
    for (let x = 0; x < width; x += 1) {
      const i = base + 1 + x * 3;
      const checker = ((x >> 7) + (y >> 7)) & 1 ? 24 : 0;
      raw[i] = ((x * 255) / width + checker) & 255;
      raw[i + 1] = ((y * 255) / rows + checker) & 255;
      raw[i + 2] = (((x + y) * 255) / (width + rows)) & 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(rows, 4);
  header[8] = 8;
  header[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return { data: png, width, height: rows };
}

const image =
  imageMp > 0
    ? (() => {
        const png = makePng(imageMp);
        return {
          ...png,
          url: `data:image/png;base64,${png.data.toString("base64")}`,
        };
      })()
    : null;

function id(prefix: string, n: number): string {
  return `${prefix}${n.toString(36).padStart(6, "0")}`;
}

function screenHtml(index: number): string {
  const sections = Math.max(1, Math.ceil(dom / 50));
  const nodes: string[] = [];
  let emitted = 0;
  for (let s = 0; s < sections && emitted < dom; s += 1) {
    const inner: string[] = [];
    for (let c = 0; c < 49 && emitted + 1 < dom; c += 1) {
      inner.push(`<p class="c">Item ${index}.${s}.${c} lorem ipsum dolor</p>`);
      emitted += 1;
    }
    nodes.push(`<section class="s">${inner.join("")}</section>`);
    emitted += 1;
  }
  const images = image
    ? Array.from(
        { length: imagesPerScreen },
        (_, n) =>
          `<img class="big" alt="" width="${image.width}" height="${image.height}" src="${image.url}" data-n="${n}">`,
      ).join("")
    : "";
  const script =
    loops > 0
      ? `<script>
(function () {
  var el = document.getElementById("spin");
  var n = ${loops};
  for (var i = 0; i < n; i += 1) {
    (function (k) {
      var t = 0;
      function step() {
        t += 1;
        el.style.setProperty("--p" + k, String(t % 360));
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    })(i);
  }
})();
</script>`
      : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${BASELINE.width}, initial-scale=1">
<title>Sweep screen ${index}</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: ${BASELINE.width}px; height: ${height}px; overflow: hidden; background: #f6f6f4; font: 14px/1.4 system-ui, sans-serif; color: #222; } /* guard:allow-raw-color — synthetic bench page */
  .s { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; padding: 8px; border-bottom: 1px solid #ddd; } /* guard:allow-raw-color — synthetic bench page */
  .c { margin: 0; padding: 4px; background: #fff; border: 1px solid #e3e3e0; border-radius: 4px; } /* guard:allow-raw-color — synthetic bench page */
  .big { display: block; width: 100%; height: auto; }
  #spin { position: fixed; top: 0; left: 0; width: 8px; height: 8px; }
</style>
</head>
<body>
<h1 style="margin:8px">Screen ${index}</h1>
<div id="spin"></div>
${nodes.join("\n")}
${images}
${script}
</body>
</html>`;
}

const boardHtml = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { background: transparent; } /* guard:allow-raw-color — synthetic bench page */
  body { margin: 0; position: relative; overflow: visible; }
</style>
</head>
<body>
</body>
</html>`;

const columns = screens < 4 ? 1 : Math.ceil(Math.sqrt(screens));
const MIN_BOARD_HEIGHT = 30_000;
const rowCount = Math.ceil(screens / columns);
const rowGap = Math.max(
  BASELINE.gap,
  Math.ceil((MIN_BOARD_HEIGHT - rowCount * height) / Math.max(1, rowCount - 1)),
);
const files: {
  id: string;
  filename: string;
  content: string;
  fileType: string;
}[] = [
  {
    id: id("b", 0),
    filename: "__board__.html",
    content: boardHtml,
    fileType: "html",
  },
];
const canvasFrames: Record<string, Record<string, number>> = {};
const screenMetadata: Record<string, Record<string, unknown>> = {};
for (let i = 0; i < screens; i += 1) {
  const fileId = id("s", i + 1);
  files.push({
    id: fileId,
    filename: `screen-${String(i + 1).padStart(4, "0")}.html`,
    content: screenHtml(i + 1),
    fileType: "html",
  });
  canvasFrames[fileId] = {
    x: (i % columns) * (BASELINE.width + BASELINE.gap),
    y: Math.floor(i / columns) * (height + rowGap),
    width: BASELINE.width,
    height,
    z: 0,
  };
  screenMetadata[fileId] = {
    width: BASELINE.width,
    height,
    heightMode: "fixed",
    heightPinned: true,
    breakpointWidths: [],
  };
}

const title =
  values.title ??
  `Sweep screens=${screens} dom=${dom} height=${height} imageMp=${imageMp} loops=${loops}`;
const data = {
  boardFileId: id("b", 0),
  boardObjects: null,
  fileCount: files.length - 1,
  canvasFrames,
  screenMetadata,
  localhostScreens: {},
  designVariantSets: {},
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify({
    id: null,
    title,
    projectType: "prototype",
    data: JSON.stringify(data),
    files,
  }),
);
console.log(
  `${out}: ${screens} screens, ${dom} dom/screen, ${height}px tall, image ${imageMp}MP${image ? ` (${image.width}x${image.height}, ${Math.round(image.data.length / 1024)} KiB png)` : ""}, ${loops} rAF loops/screen`,
);
