/**
 * Logo lookup using Logo.dev API (replacement for deprecated Clearbit Logo API)
 * Usage: pnpm script logo-lookup --domain intuit.com [--size 128]
 *
 * Logo.dev API: https://img.logo.dev/{domain}?token={key}
 * - Free tier with generous monthly requests (sign up at https://logo.dev/signup)
 * - Returns company logo as PNG/JPG/WebP
 * - Supports ?size=N, ?format=png, ?greyscale=true, ?retina=true
 * - Set LOGO_DEV_TOKEN env var for API access
 * - Without a token, the script outputs the URL pattern for manual use
 */

function parseArgs(args: string[]): { domain?: string; size?: number; format?: string; greyscale?: boolean } {
  const result: { domain?: string; size?: number; format?: string; greyscale?: boolean } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--domain" && args[i + 1]) {
      result.domain = args[++i];
    } else if (args[i] === "--size" && args[i + 1]) {
      result.size = parseInt(args[++i], 10);
    } else if (args[i] === "--format" && args[i + 1]) {
      result.format = args[++i];
    } else if (args[i] === "--greyscale") {
      result.greyscale = true;
    } else if (!args[i].startsWith("--")) {
      result.domain = args[i];
    }
  }
  return result;
}

export default async function main(args: string[]) {
  const { domain, size = 128, format, greyscale } = parseArgs(args);

  if (!domain) {
    console.error("Usage: pnpm script logo-lookup --domain intuit.com [--size 128] [--greyscale]");
    console.error("       pnpm script logo-lookup intuit.com");
    console.error("\nRequires LOGO_DEV_TOKEN env var. Sign up free at https://logo.dev/signup");
    process.exit(1);
  }

  const token = process.env.LOGO_DEV_TOKEN;

  // Clean up domain
  const cleanDomain = domain
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];

  // Build URL params
  const params = new URLSearchParams();
  if (token) params.set("token", token);
  if (size) params.set("size", String(size));
  if (format) params.set("format", format);
  if (greyscale) params.set("greyscale", "true");

  const paramStr = params.toString();
  const logoUrl = `https://img.logo.dev/${cleanDomain}${paramStr ? `?${paramStr}` : ""}`;

  if (!token) {
    console.log("\n⚠️  No LOGO_DEV_TOKEN set. Sign up free at https://logo.dev/signup");
    console.log("   Then set: LOGO_DEV_TOKEN=pk_your_token_here");
    console.log(`\nURL pattern (add your token):`);
    console.log(`  https://img.logo.dev/${cleanDomain}?token=YOUR_TOKEN&size=${size}`);
  } else {
    console.log(`\nLogo.dev URL for "${cleanDomain}":`);
    console.log(`  ${logoUrl}`);
  }

  console.log(`\nHTML for slides:`);
  console.log(`  <img src="${logoUrl}" alt="${cleanDomain.split('.')[0]}" style="height: 40px; width: auto; object-fit: contain;" />`);

  if (format === "json" || args.includes("--json")) {
    console.log(`\n---JSON---`);
    const baseUrl = `https://img.logo.dev/${cleanDomain}`;
    const tokenParam = token ? `token=${token}` : "token=YOUR_TOKEN";
    console.log(JSON.stringify({
      domain: cleanDomain,
      url: logoUrl,
      hasToken: !!token,
      sizes: {
        small: `${baseUrl}?${tokenParam}&size=64`,
        medium: `${baseUrl}?${tokenParam}&size=128`,
        large: `${baseUrl}?${tokenParam}&size=256`,
      },
    }, null, 2));
  }
}
