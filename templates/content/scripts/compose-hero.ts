import sharp from "sharp";
import path from "path";
import fs from "fs";
import { loadEnv, parseArgs, camelCaseArgs, PROJECTS_DIR } from "./_utils.js";
import { uploadBufferToBuilderCDN } from "../server/utils/builder-upload.js";

const FONT_PATH = "/usr/share/fonts/truetype/custom/Caveat.ttf";

/**
 * Claude AI logo mark — starburst with radiating petals.
 */
function createClaudeLogoSvg(size: number): string {
  const cx = size / 2;
  const cy = size / 2;
  const color = "#D97757";
  const petalCount = 7;
  const outerRadius = size * 0.45;
  const petalHalfWidth = size * 0.04;
  const innerRadius = size * 0.08;

  let petals = "";
  for (let i = 0; i < petalCount; i++) {
    const angle = ((i * 360) / petalCount - 90) * (Math.PI / 180);
    const tipX = cx + Math.cos(angle) * outerRadius;
    const tipY = cy + Math.sin(angle) * outerRadius;
    const perpAngle = angle + Math.PI / 2;
    const baseX1 = cx + Math.cos(perpAngle) * petalHalfWidth;
    const baseY1 = cy + Math.sin(perpAngle) * petalHalfWidth;
    const baseX2 = cx - Math.cos(perpAngle) * petalHalfWidth;
    const baseY2 = cy - Math.sin(perpAngle) * petalHalfWidth;
    const midRadius = outerRadius * 0.5;
    const bulge = petalHalfWidth * 2.5;
    const cp1X = cx + Math.cos(angle) * midRadius + Math.cos(perpAngle) * bulge;
    const cp1Y = cy + Math.sin(angle) * midRadius + Math.sin(perpAngle) * bulge;
    const cp2X = cx + Math.cos(angle) * midRadius - Math.cos(perpAngle) * bulge;
    const cp2Y = cy + Math.sin(angle) * midRadius - Math.sin(perpAngle) * bulge;
    petals += `<path d="M${baseX1},${baseY1} Q${cp1X},${cp1Y} ${tipX},${tipY} Q${cp2X},${cp2Y} ${baseX2},${baseY2} Z" fill="${color}"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    ${petals}
    <circle cx="${cx}" cy="${cy}" r="${innerRadius}" fill="${color}"/>
  </svg>`;
}

/**
 * Create text SVG with embedded font (base64) for reliable rendering.
 */
function createTextSvg(
  text: string,
  width: number,
  height: number,
  fontSize: number,
  color = "#FFFFFF",
): string {
  let fontFace = "";
  if (fs.existsSync(FONT_PATH)) {
    const fontData = fs.readFileSync(FONT_PATH).toString("base64");
    fontFace = `
      <defs>
        <style type="text/css">
          @font-face {
            font-family: 'Caveat';
            src: url('data:font/truetype;base64,${fontData}') format('truetype');
          }
        </style>
      </defs>`;
  }

  const fontFamily = fs.existsSync(FONT_PATH) ? "Caveat" : "DejaVu Serif";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${fontFace}
    <text x="${width / 2}" y="${height / 2 + fontSize * 0.35}"
          font-family="${fontFamily}"
          font-size="${fontSize}"
          font-weight="600"
          fill="${color}"
          text-anchor="middle"
          letter-spacing="4">${text}</text>
  </svg>`;
}

export default async function main(args: string[]) {
  loadEnv();
  const raw = parseArgs(args);
  const opts = camelCaseArgs(raw);

  if (raw["help"]) {
    console.log(`Usage: npm run script -- compose-hero --project-slug <slug> [options]

Options:
  --project-slug    Project to save to (required)
  --width           Image width (default: 2000)
  --height          Image height (default: 1125)
  --output          Output filename (default: hero-composite.png)
  --logo-size       Logo size in px (default: 500)
  --text            Text below logo (default: "for designers")`);
    return;
  }

  const projectSlug = opts.projectSlug;
  if (!projectSlug) {
    console.error("--project-slug is required");
    process.exit(1);
  }

  const width = parseInt(opts.width || "2000", 10);
  const height = parseInt(opts.height || "1125", 10);
  const outputName = opts.output || "hero-composite.png";
  const logoSize = parseInt(opts.logoSize || "500", 10);
  const text = opts.text || "for designers";

  console.log(`Creating ${width}x${height} hero composite...`);
  console.log(
    `Font available: ${fs.existsSync(FONT_PATH) ? "Caveat (embedded)" : "DejaVu Serif (fallback)"}`,
  );

  // 1. Render Claude logo
  const logoSvg = createClaudeLogoSvg(logoSize);
  const logoBuffer = await sharp(Buffer.from(logoSvg)).png().toBuffer();
  console.log(
    `Logo: ${logoSize}x${logoSize}px, ${Math.round(logoBuffer.length / 1024)}KB`,
  );

  // 2. Render text with embedded font
  const textWidth = 1200;
  const textHeight = 250;
  const fontSize = 140;
  const textSvg = createTextSvg(text, textWidth, textHeight, fontSize);
  const textBuffer = await sharp(Buffer.from(textSvg)).png().toBuffer();
  const textStats = await sharp(textBuffer).stats();
  console.log(
    `Text: ${textWidth}x${textHeight}px, mean R=${Math.round(textStats.channels[0].mean)}`,
  );

  // 3. Design motifs overlay (subtle)
  const motifsSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <g transform="translate(${width * 0.1}, ${height * 0.18}) scale(2.5)" opacity="0.15">
      <path d="M0 50 L15 0 L30 50 L15 42 Z" fill="none" stroke="white" stroke-width="2.5"/>
    </g>
    <g transform="translate(${width * 0.78}, ${height * 0.68}) scale(2.5)" opacity="0.13">
      <path d="M0 40 C20 0 60 0 80 40" fill="none" stroke="white" stroke-width="2.5"/>
      <circle cx="0" cy="40" r="5" fill="white"/>
      <circle cx="80" cy="40" r="5" fill="white"/>
      <circle cx="20" cy="0" r="4" fill="none" stroke="white" stroke-width="2"/>
      <circle cx="60" cy="0" r="4" fill="none" stroke="white" stroke-width="2"/>
      <line x1="0" y1="40" x2="20" y2="0" stroke="white" stroke-width="1.5" opacity="0.5"/>
      <line x1="80" y1="40" x2="60" y2="0" stroke="white" stroke-width="1.5" opacity="0.5"/>
    </g>
    <g transform="translate(${width * 0.85}, ${height * 0.2}) scale(3)" opacity="0.13">
      <rect x="0" y="0" width="20" height="20" rx="3" fill="#D97757"/>
      <rect x="26" y="0" width="20" height="20" rx="3" fill="white"/>
      <rect x="13" y="26" width="20" height="20" rx="3" fill="#888"/>
    </g>
    <g transform="translate(${width * 0.08}, ${height * 0.74}) scale(3)" opacity="0.1">
      ${Array.from({ length: 5 }, (_, r) =>
        Array.from(
          { length: 5 },
          (_, c) =>
            `<circle cx="${c * 14}" cy="${r * 14}" r="2" fill="white"/>`,
        ).join(""),
      ).join("")}
    </g>
  </svg>`;
  const motifsBuffer = await sharp(Buffer.from(motifsSvg)).png().toBuffer();

  // 4. Composite on black background
  const logoX = Math.round((width - logoSize) / 2);
  const logoY = Math.round(height * 0.15);
  const textX = Math.round((width - textWidth) / 2);
  const textY = Math.round(logoY + logoSize + 40);

  const result = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite([
      { input: motifsBuffer, top: 0, left: 0 },
      { input: logoBuffer, top: logoY, left: logoX },
      { input: textBuffer, top: textY, left: textX },
    ])
    .png()
    .toBuffer();

  // Save
  const mediaDir = path.join(PROJECTS_DIR, projectSlug, "media");
  if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

  const mimeType = "image/png";
  const cdnUrl = await uploadBufferToBuilderCDN(outputName, result, mimeType);

  const metadataPath = path.join(mediaDir, `${outputName}.json`);
  const metadata = {
    filename: outputName,
    url: cdnUrl,
    type: "image",
    size: result.length,
    mimeType: mimeType,
    modifiedAt: Date.now(),
  };
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

  const finalStats = await sharp(result).stats();
  console.log(
    `Final means: R=${Math.round(finalStats.channels[0].mean)} G=${Math.round(finalStats.channels[1].mean)} B=${Math.round(finalStats.channels[2].mean)}`,
  );
  console.log(`\nUploaded to Builder CDN: ${cdnUrl}`);
  console.log(`Size: ${Math.round(result.length / 1024)}KB`);
}
