import sharp from "sharp";
import path from "path";
import fs from "fs";
import { loadEnv, PROJECTS_DIR } from "./_utils.js";
import { uploadBufferToBuilderCDN } from "../server/utils/builder-upload.js";

const W = 1600;
const H = 900;
const FONT_PATH = "/usr/share/fonts/truetype/custom/Caveat.ttf";

function getFontDefs(): { fontFace: string; fontFamily: string } {
  if (fs.existsSync(FONT_PATH)) {
    const fontData = fs.readFileSync(FONT_PATH).toString("base64");
    return {
      fontFace: `<defs><style type="text/css">@font-face { font-family: 'Caveat'; src: url('data:font/truetype;base64,${fontData}') format('truetype'); }</style></defs>`,
      fontFamily: "Caveat",
    };
  }
  return { fontFace: "", fontFamily: "DejaVu Serif" };
}

function createDiagramSvg(): string {
  const { fontFace, fontFamily } = getFontDefs();

  // 4 stages evenly spaced
  const stageY = H / 2;
  const stageSpacing = W / 5;
  const stages = [
    {
      x: stageSpacing * 1,
      label: "Terminal",
      sublabel: "Setup",
      icon: "terminal",
    },
    {
      x: stageSpacing * 2,
      label: "Claude Code",
      sublabel: "Build",
      icon: "claude",
    },
    {
      x: stageSpacing * 3,
      label: "Preview",
      sublabel: "Review",
      icon: "browser",
    },
    { x: stageSpacing * 4, label: "Git Merge", sublabel: "Ship", icon: "git" },
  ];

  const cardW = 200;
  const cardH = 180;
  const iconSize = 50;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${fontFace}

    <!-- Title -->
    <text x="${W / 2}" y="80"
          font-family="sans-serif" font-size="36" font-weight="700"
          fill="white" text-anchor="middle" letter-spacing="1">
      The Designer Workflow
    </text>
    <text x="${W / 2}" y="120"
          font-family="${fontFamily}" font-size="28"
          fill="#D97757" text-anchor="middle" letter-spacing="1" opacity="0.9">
      from setup to shipped
    </text>`;

  // Draw connecting arrows between stages
  for (let i = 0; i < stages.length - 1; i++) {
    const fromX = stages[i].x + cardW / 2 + 10;
    const toX = stages[i + 1].x - cardW / 2 - 10;
    const midX = (fromX + toX) / 2;
    svg += `
    <path d="M ${fromX} ${stageY} C ${midX} ${stageY - 20} ${midX} ${stageY - 20} ${toX} ${stageY}"
          fill="none" stroke="#D97757" stroke-width="2.5" stroke-dasharray="8 4" opacity="0.6"/>
    <polygon points="${toX},${stageY} ${toX - 10},${stageY - 6} ${toX - 10},${stageY + 6}"
             fill="#D97757" opacity="0.6"/>`;
  }

  // Draw stage cards
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    const cx = s.x;
    const cy = stageY;
    const rx = cx - cardW / 2;
    const ry = cy - cardH / 2;

    // Card background
    svg += `
    <rect x="${rx}" y="${ry}" width="${cardW}" height="${cardH}" rx="12"
          fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>`;

    // Stage number
    svg += `
    <circle cx="${rx + 20}" cy="${ry + 20}" r="12" fill="#D97757" opacity="0.8"/>
    <text x="${rx + 20}" y="${ry + 25}" font-family="sans-serif" font-size="14" font-weight="700"
          fill="white" text-anchor="middle">${i + 1}</text>`;

    // Icon area (placeholder - Claude stage will get real logo composited)
    const iconY = cy - 20;
    if (s.icon === "terminal") {
      // Terminal icon
      svg += `
      <rect x="${cx - 25}" y="${iconY - 22}" width="50" height="36" rx="4"
            fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1.5"/>
      <text x="${cx - 15}" y="${iconY + 4}" font-family="monospace" font-size="14" fill="#4ade80">$_</text>`;
    } else if (s.icon === "browser") {
      // Browser window icon
      svg += `
      <rect x="${cx - 25}" y="${iconY - 22}" width="50" height="36" rx="4"
            fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1.5"/>
      <line x1="${cx - 25}" y1="${iconY - 12}" x2="${cx + 25}" y2="${iconY - 12}"
            stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
      <circle cx="${cx - 18}" cy="${iconY - 17}" r="2.5" fill="#ef4444"/>
      <circle cx="${cx - 10}" cy="${iconY - 17}" r="2.5" fill="#eab308"/>
      <circle cx="${cx - 2}" cy="${iconY - 17}" r="2.5" fill="#22c55e"/>`;
    } else if (s.icon === "git") {
      // Git merge icon
      svg += `
      <circle cx="${cx - 10}" cy="${iconY - 10}" r="6" fill="none" stroke="#f97316" stroke-width="2"/>
      <circle cx="${cx + 10}" cy="${iconY - 10}" r="6" fill="none" stroke="#22c55e" stroke-width="2"/>
      <circle cx="${cx}" cy="${iconY + 10}" r="6" fill="none" stroke="#8b5cf6" stroke-width="2"/>
      <line x1="${cx - 6}" y1="${iconY - 5}" x2="${cx - 2}" y2="${iconY + 4}" stroke="rgba(255,255,255,0.4)" stroke-width="1.5"/>
      <line x1="${cx + 6}" y1="${iconY - 5}" x2="${cx + 2}" y2="${iconY + 4}" stroke="rgba(255,255,255,0.4)" stroke-width="1.5"/>`;
    }
    // Claude icon is a placeholder — real logo composited via sharp

    // Labels
    svg += `
    <text x="${cx}" y="${cy + 50}" font-family="sans-serif" font-size="18" font-weight="600"
          fill="white" text-anchor="middle">${s.label}</text>
    <text x="${cx}" y="${cy + 72}" font-family="${fontFamily}" font-size="22"
          fill="#D97757" text-anchor="middle" opacity="0.8">${s.sublabel}</text>`;
  }

  // Subtle background motifs
  svg += `
    <!-- Dot grid top-left -->
    <g transform="translate(30, 160)" opacity="0.06">
      ${Array.from({ length: 4 }, (_, r) =>
        Array.from(
          { length: 4 },
          (_, c) =>
            `<circle cx="${c * 16}" cy="${r * 16}" r="2" fill="white"/>`,
        ).join(""),
      ).join("")}
    </g>
    <!-- Dot grid bottom-right -->
    <g transform="translate(${W - 100}, ${H - 100})" opacity="0.06">
      ${Array.from({ length: 4 }, (_, r) =>
        Array.from(
          { length: 4 },
          (_, c) =>
            `<circle cx="${c * 16}" cy="${r * 16}" r="2" fill="white"/>`,
        ).join(""),
      ).join("")}
    </g>`;

  svg += `</svg>`;
  return svg;
}

export default async function main() {
  loadEnv();

  const projectSlug = "steve/claude-code-for-designers";
  const outDir = path.join(PROJECTS_DIR, projectSlug, "media");
  // Prefer Brandfetch logo (transparent bg), fall back to local reference
  const brandfetchLogo = path.join(
    PROJECTS_DIR,
    projectSlug,
    "media/claude-logo-brandfetch-claude.png",
  );
  const localLogo = path.join(
    PROJECTS_DIR,
    projectSlug,
    "media/claude-logo-reference.png",
  );
  const logoPath = fs.existsSync(brandfetchLogo) ? brandfetchLogo : localLogo;

  if (!fs.existsSync(logoPath)) {
    console.error("Claude logo not found. Run fetch-brand-logo first.");
    process.exit(1);
  }

  const usingBrandfetch = logoPath === brandfetchLogo;
  console.log(
    `Compositing workflow diagram with ${usingBrandfetch ? "Brandfetch" : "local"} Claude logo...`,
  );

  const logoSize = 55;

  // Always remove light backgrounds (white, beige, cream)
  const rawLogo = await sharp(logoPath)
    .resize(logoSize, logoSize, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = rawLogo;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    const lightness = (r + g + b) / 3;
    if (lightness > 220 && Math.abs(r - g) < 30 && Math.abs(g - b) < 30) {
      data[i + 3] = 0;
    } else if (
      lightness > 180 &&
      Math.abs(r - g) < 30 &&
      Math.abs(g - b) < 30
    ) {
      data[i + 3] = Math.round(255 * (1 - (lightness - 180) / 60));
    }
  }
  const logoBuffer = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();

  // Render the diagram SVG
  const diagramSvg = createDiagramSvg();
  const diagramBuffer = await sharp(Buffer.from(diagramSvg)).png().toBuffer();

  // Stage 2 position: Claude Code card center
  const stageSpacing = W / 5;
  const stage2X = stageSpacing * 2;
  const stageY = H / 2;
  const logoX = Math.round(stage2X - logoSize / 2);
  const logoY = Math.round(stageY - 42);

  // Composite: diagram + real Claude logo on stage 2
  const result = await sharp({
    create: {
      width: W,
      height: H,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite([
      { input: diagramBuffer, top: 0, left: 0 },
      { input: logoBuffer, top: logoY, left: logoX },
    ])
    .png()
    .toBuffer();

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = "workflow-diagram-v2.png";

  const cdnUrl = await uploadBufferToBuilderCDN(outFile, result, "image/png");

  const metadataPath = path.join(outDir, `${outFile}.json`);
  const metadata = {
    filename: outFile,
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
