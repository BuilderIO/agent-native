import sharp from "sharp";
import path from "path";
import fs from "fs";
import { loadEnv, parseArgs, camelCaseArgs, PROJECTS_DIR } from "./_utils.js";

const FONT_PATH = "/usr/share/fonts/truetype/custom/Caveat.ttf";
import { uploadBufferToBuilderCDN } from "../server/utils/builder-upload.js";

const W = 2000;
const H = 1125;

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

function createClaudeCodeTextSvg(): string {
  const { fontFace, fontFamily } = getFontDefs();
  const width = 1400;
  const height = 500;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${fontFace}
    <!-- "Claude Code" in clean sans-serif -->
    <text x="${width / 2}" y="160"
          font-family="sans-serif"
          font-size="120"
          font-weight="700"
          fill="white"
          text-anchor="middle"
          letter-spacing="3">Claude Code</text>
    <!-- Hand-drawn arrow curving down to "for designers" -->
    <path d="M ${width / 2 + 200} 200 C ${width / 2 + 220} 260 ${width / 2 + 160} 310 ${width / 2 + 80} 330"
          fill="none" stroke="white" stroke-width="4" stroke-linecap="round" opacity="0.85"/>
    <!-- Arrowhead -->
    <polygon points="${width / 2 + 80},322 ${width / 2 + 100},340 ${width / 2 + 72},342" fill="white" opacity="0.85"/>
    <!-- "for designers" in large handwritten Caveat -->
    <text x="${width / 2}" y="430"
          font-family="${fontFamily}"
          font-size="140"
          font-weight="600"
          fill="white"
          text-anchor="middle"
          letter-spacing="3">for designers</text>
  </svg>`;
}

function createMotifsSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <!-- Pen tool -->
    <g transform="translate(${W * 0.1}, ${H * 0.2}) scale(2.5)" opacity="0.15">
      <path d="M0 50 L15 0 L30 50 L15 42 Z" fill="none" stroke="white" stroke-width="2.5"/>
    </g>
    <!-- Stacked layers -->
    <g transform="translate(${W * 0.78}, ${H * 0.7}) scale(2.5)" opacity="0.13">
      <path d="M40 0 L80 15 L40 30 L0 15 Z" fill="none" stroke="white" stroke-width="2.5"/>
      <path d="M0 25 L40 40 L80 25" fill="none" stroke="white" stroke-width="2.5"/>
      <path d="M0 35 L40 50 L80 35" fill="none" stroke="white" stroke-width="2.5"/>
    </g>
    <!-- Color swatches -->
    <g transform="translate(${W * 0.84}, ${H * 0.2}) scale(3)" opacity="0.13">
      <rect x="0" y="0" width="20" height="20" rx="3" fill="#D97757"/>
      <rect x="26" y="0" width="20" height="20" rx="3" fill="white"/>
      <rect x="13" y="26" width="20" height="20" rx="3" fill="#888"/>
    </g>
    <!-- Dot grid -->
    <g transform="translate(${W * 0.08}, ${H * 0.74}) scale(3)" opacity="0.1">
      ${Array.from({ length: 5 }, (_, r) =>
        Array.from(
          { length: 5 },
          (_, c) =>
            `<circle cx="${c * 14}" cy="${r * 14}" r="2" fill="white"/>`,
        ).join(""),
      ).join("")}
    </g>
  </svg>`;
}

interface BrandfetchLogo {
  type: "logo" | "symbol" | "icon";
  theme: "light" | "dark" | null;
  formats: Array<{
    src: string;
    background: string | null;
    format: string;
    height?: number;
    width?: number;
    size?: number;
  }>;
}

interface BrandfetchResponse {
  logos?: BrandfetchLogo[];
}

/**
 * Fetch a high-quality logo from Brandfetch API.
 * Prefers: dark symbol PNG > light symbol PNG > dark logo PNG > light logo PNG
 */
async function fetchLogoBrandfetch(domain: string): Promise<Buffer> {
  const apiKey = process.env.BRANDFETCH_API_KEY;
  if (!apiKey) {
    throw new Error(
      "BRANDFETCH_API_KEY not set. Set it via DevServerControl or .env",
    );
  }

  console.log(`Fetching brand data from Brandfetch for ${domain}...`);
  const res = await fetch(`https://api.brandfetch.io/v2/brands/${domain}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error(`Brandfetch API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as BrandfetchResponse;
  const logos = data.logos || [];

  if (logos.length === 0) {
    throw new Error(`No logos found for ${domain} on Brandfetch`);
  }

  // Score each logo format for best match
  type Candidate = { url: string; score: number; width: number };
  const candidates: Candidate[] = [];

  for (const logo of logos) {
    for (const fmt of logo.formats) {
      if (fmt.format !== "png" && fmt.format !== "svg") continue;

      let score = 0;
      // Prefer symbol/icon over full wordmark
      if (logo.type === "symbol" || logo.type === "icon") score += 100;
      // Prefer dark theme for dark backgrounds
      if (logo.theme === "dark") score += 50;
      // Prefer PNG (easier for sharp compositing)
      if (fmt.format === "png") score += 20;
      // Prefer larger dimensions
      score += Math.min(fmt.width || 0, 500) / 10;

      candidates.push({ url: fmt.src, score, width: fmt.width || 0 });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    throw new Error(`No usable logo formats found for ${domain}`);
  }

  const best = candidates[0];
  console.log(
    `Selected logo: score=${best.score}, width=${best.width}, url=${best.url}`,
  );

  const logoRes = await fetch(best.url);
  if (!logoRes.ok) {
    throw new Error(`Failed to download logo: ${logoRes.status}`);
  }

  return Buffer.from(await logoRes.arrayBuffer());
}

/**
 * Fallback: fetch logo from local file (existing behavior).
 */
function fetchLogoLocal(logoPath: string): Buffer {
  if (!fs.existsSync(logoPath)) {
    throw new Error("Logo not found at " + logoPath);
  }
  return fs.readFileSync(logoPath);
}

export default async function main(args: string[]) {
  loadEnv();

  const raw = parseArgs(args);
  const opts = camelCaseArgs(raw);
  const domain = (opts.domain as string) || "claude.ai";
  const projectSlug =
    (opts.projectSlug as string) || "steve/claude-code-for-designers";
  const outDir = path.join(PROJECTS_DIR, projectSlug, "media");
  const localLogoPath = path.join(
    PROJECTS_DIR,
    "steve/claude-code-for-designers/media/claude-logo-reference.png",
  );

  console.log("Compositing hero with real Claude logo...");
  console.log(`Font: ${fs.existsSync(FONT_PATH) ? "Caveat" : "DejaVu Serif"}`);

  // Try Brandfetch first, fall back to local file
  let rawLogoBuffer: Buffer;
  let needsWhiteBgRemoval = false;

  if (process.env.BRANDFETCH_API_KEY) {
    try {
      rawLogoBuffer = await fetchLogoBrandfetch(domain);
      console.log("Logo fetched via Brandfetch");
    } catch (err: any) {
      console.warn(
        `Brandfetch failed: ${err.message}. Falling back to local logo.`,
      );
      rawLogoBuffer = fetchLogoLocal(localLogoPath);
    }
  } else {
    console.log("No BRANDFETCH_API_KEY set, using local logo file");
    rawLogoBuffer = fetchLogoLocal(localLogoPath);
  }

  // Upscale logo and always remove light backgrounds (white, beige, cream)
  const logoSize = 400;
  const rawLogo = await sharp(rawLogoBuffer)
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
    // Remove white, beige, cream backgrounds (all channels > 200 and similar)
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
  console.log(`Logo upscaled to ${logoSize}x${logoSize} (light bg removed)`);

  // Render combined text block (Claude Code + arrow + for designers)
  const textSvg = createClaudeCodeTextSvg();
  const textBuffer = await sharp(Buffer.from(textSvg)).png().toBuffer();
  console.log("Text block rendered");

  // Motifs
  const motifsSvg = createMotifsSvg();
  const motifsBuffer = await sharp(Buffer.from(motifsSvg)).png().toBuffer();

  // Positions — logo centered top, text block below
  const logoX = Math.round((W - logoSize) / 2);
  const logoY = Math.round(H * 0.08);
  const textX = Math.round((W - 1400) / 2);
  const textY = Math.round(logoY + logoSize + 20);

  // Composite on black
  const result = await sharp({
    create: {
      width: W,
      height: H,
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

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = "hero-v8-claude-code.png";

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
