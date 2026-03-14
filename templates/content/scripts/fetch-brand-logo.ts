import fs from "fs";
import path from "path";
import { loadEnv, parseArgs, camelCaseArgs, fail, PROJECTS_DIR } from "./_utils.js";
import { uploadBufferToBuilderCDN } from "../server/utils/builder-upload.js";

interface BrandfetchLogo {
  type: string;
  theme: string | null;
  formats: Array<{
    src: string;
    background: string | null;
    format: string;
    height?: number;
    width?: number;
  }>;
}

export default async function main(args: string[]) {
  loadEnv();

  const raw = parseArgs(args);
  const opts = camelCaseArgs(raw);

  const domain = (opts.domain as string) || "anthropic.com";
  const projectSlug = (opts.projectSlug as string) || "steve/claude-code-for-designers";
  const outputName = (opts.outputName as string) || "brand-logo.png";

  const apiKey = process.env.BRANDFETCH_API_KEY;
  if (!apiKey) fail("BRANDFETCH_API_KEY not set");

  console.log(`Fetching brand data for ${domain}...`);
  const res = await fetch(`https://api.brandfetch.io/v2/brands/${domain}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    fail(`Brandfetch API error: ${res.status} ${res.statusText} - ${await res.text()}`);
  }

  const data = await res.json();
  const logos: BrandfetchLogo[] = data.logos || [];

  console.log(`Found ${logos.length} logo entries:`);
  for (const logo of logos) {
    console.log(`  Type: ${logo.type} | Theme: ${logo.theme}`);
    for (const fmt of logo.formats) {
      console.log(`    Format: ${fmt.format} | ${fmt.width}x${fmt.height} | ${fmt.src}`);
    }
  }

  // Score and pick the best logo
  type Candidate = { url: string; score: number; format: string; width: number; type: string; theme: string | null };
  const candidates: Candidate[] = [];

  for (const logo of logos) {
    for (const fmt of logo.formats) {
      let score = 0;
      if (logo.type === "symbol" || logo.type === "icon") score += 100;
      if (logo.theme === "dark") score += 50;
      if (fmt.format === "png") score += 20;
      if (fmt.format === "svg") score += 10;
      score += Math.min(fmt.width || 0, 500) / 10;

      candidates.push({
        url: fmt.src,
        score,
        format: fmt.format,
        width: fmt.width || 0,
        type: logo.type,
        theme: logo.theme,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0) fail(`No usable logos found for ${domain}`);

  // Download top candidate
  const best = candidates[0];
  console.log(`\nSelected: type=${best.type}, theme=${best.theme}, format=${best.format}, width=${best.width}`);
  console.log(`URL: ${best.url}`);

  const logoRes = await fetch(best.url);
  if (!logoRes.ok) fail(`Failed to download logo: ${logoRes.status}`);

  const buffer = Buffer.from(await logoRes.arrayBuffer());
  const outDir = path.join(PROJECTS_DIR, projectSlug, "media");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const mimeType = logoRes.headers.get("content-type") || `image/${best.format}`;
  const cdnUrl = await uploadBufferToBuilderCDN(outputName, buffer, mimeType);

  const metadataPath = path.join(outDir, `${outputName}.json`);
  const metadata = {
    filename: outputName,
    url: cdnUrl,
    type: "image",
    size: buffer.length,
    mimeType: mimeType,
    modifiedAt: Date.now(),
  };
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

  console.log(`\nUploaded to Builder CDN: ${cdnUrl} (${Math.round(buffer.length / 1024)}KB)`);
  console.log(`Saved metadata to: ${metadataPath}`);

  // Also show all candidates for reference
  console.log(`\nAll ${candidates.length} candidates (top 5):`);
  candidates.slice(0, 5).forEach((c, i) => {
    console.log(`  ${i + 1}. score=${c.score} type=${c.type} theme=${c.theme} fmt=${c.format} w=${c.width}`);
    console.log(`     ${c.url}`);
  });
}
