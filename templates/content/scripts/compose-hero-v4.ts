import sharp from "sharp";
import path from "path";
import fs from "fs";
import { loadEnv, PROJECTS_DIR } from "./_utils.js";
import { uploadBufferToBuilderCDN } from "../server/utils/builder-upload.js";

const FONT_PATH = "/usr/share/fonts/truetype/custom/Caveat.ttf";
const W = 2000;
const H = 1125;

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

function createTextSvg(
  text: string,
  width: number,
  height: number,
  fontSize: number,
): string {
  let fontFace = "";
  let fontFamily = "DejaVu Serif";

  if (fs.existsSync(FONT_PATH)) {
    const fontData = fs.readFileSync(FONT_PATH).toString("base64");
    fontFace = `<defs><style type="text/css">@font-face { font-family: 'Caveat'; src: url('data:font/truetype;base64,${fontData}') format('truetype'); }</style></defs>`;
    fontFamily = "Caveat";
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${fontFace}
    <text x="${width / 2}" y="${height / 2 + fontSize * 0.35}"
          font-family="${fontFamily}"
          font-size="${fontSize}"
          font-weight="600"
          fill="white"
          text-anchor="middle"
          letter-spacing="4">${text}</text>
  </svg>`;
}

export default async function main() {
  loadEnv();

  const bgPath = "/tmp/hero-bg.png";
  const projectSlug = "steve/claude-code-for-designers";
  const outDir = path.join(PROJECTS_DIR, projectSlug, "media");

  if (!fs.existsSync(bgPath)) {
    console.error("Background image not found at /tmp/hero-bg.png");
    process.exit(1);
  }

  console.log("Compositing hero image...");
  console.log(
    `Font: ${fs.existsSync(FONT_PATH) ? "Caveat (embedded)" : "DejaVu Serif (fallback)"}`,
  );

  // Resize AI-generated background to 16:9
  const bg = await sharp(bgPath)
    .resize(W, H, { fit: "cover" })
    .png()
    .toBuffer();
  console.log("Background resized to 2000x1125");

  // Render logo
  const logoSize = 450;
  const logoSvg = createClaudeLogoSvg(logoSize);
  const logoBuffer = await sharp(Buffer.from(logoSvg)).png().toBuffer();
  console.log("Logo rendered");

  // Render text
  const textWidth = 1100;
  const textHeight = 220;
  const fontSize = 130;
  const textSvg = createTextSvg(
    "for designers",
    textWidth,
    textHeight,
    fontSize,
  );
  const textBuffer = await sharp(Buffer.from(textSvg)).png().toBuffer();
  console.log("Text rendered");

  // Position: logo centered above middle, text below
  const logoX = Math.round((W - logoSize) / 2);
  const logoY = Math.round(H * 0.13);
  const textX = Math.round((W - textWidth) / 2);
  const textY = Math.round(logoY + logoSize + 30);

  // Composite
  const result = await sharp(bg)
    .composite([
      { input: logoBuffer, top: logoY, left: logoX },
      { input: textBuffer, top: textY, left: textX },
    ])
    .png()
    .toBuffer();

  // Save
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const cdnUrl = await uploadBufferToBuilderCDN(
    "hero-v4-composite.png",
    result,
    "image/png",
  );

  const metadataPath = path.join(outDir, `hero-v4-composite.png.json`);
  const metadata = {
    filename: "hero-v4-composite.png",
    url: cdnUrl,
    type: "image",
    size: result.length,
    mimeType: "image/png",
    modifiedAt: Date.now(),
  };
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

  console.log(`\nUploaded to Builder CDN: ${cdnUrl}`);
  console.log(`Size: ${Math.round(result.length / 1024)}KB`);
}
