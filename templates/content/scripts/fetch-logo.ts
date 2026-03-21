import {
  loadEnv,
  parseArgs,
  camelCaseArgs,
  isValidProjectPath,
  fail,
} from "./_utils.js";
import { fetchLogo, saveLogoToProject } from "../server/handlers/clearbit.js";

export default async function main(args: string[]) {
  loadEnv();
  const raw = parseArgs(args);
  const opts = camelCaseArgs(raw);

  if (raw["help"]) {
    console.log(`Usage: npm run script -- fetch-logo --domain <domain> [options]

Options:
  --domain         Company domain, e.g. anthropic.com (required)
  --size           Logo size in px (default: 256)
  --project-slug   Project to save logo to (e.g. steve/my-project)

Uses logo.dev API if LOGO_DEV_API_KEY is set, falls back to Google favicon API.`);
    return;
  }

  const { domain, projectSlug } = opts;
  const size = parseInt(opts.size || "256", 10);

  if (!domain) fail("--domain is required (e.g. --domain anthropic.com)");

  console.log(`Fetching logo for ${domain} (size: ${size}px)...`);

  const { imageData, mimeType, source } = await fetchLogo(domain, size);
  console.log(
    `Fetched ${Math.round(imageData.length / 1024)}KB ${mimeType} logo via ${source}`,
  );

  if (projectSlug) {
    if (!isValidProjectPath(projectSlug))
      fail(`Invalid project slug: ${projectSlug}`);
    const savedPath = saveLogoToProject(
      projectSlug,
      domain,
      imageData,
      mimeType,
    );
    console.log(`Saved to: ${savedPath}`);
  } else {
    console.log(`(pass --project-slug to save to a project's media folder)`);
  }
}
