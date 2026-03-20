import {
  defineEventHandler,
  getQuery,
  setResponseStatus,
  type H3Event,
} from "h3";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { uploadBufferToBuilderCDN } from "../utils/builder-upload";

const PROJECTS_DIR = path.join(process.cwd(), "content", "projects");

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function isValidProjectPath(project: string): boolean {
  if (!project) return false;
  const normalized = path.posix.normalize(project);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return false;
  if (normalized.includes("\0")) return false;
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length) return false;
  return segments.every((s) => /^[a-z0-9][a-z0-9-]*$/.test(s));
}

/**
 * Fetch a company logo. Tries logo.dev first (if API key is set),
 * falls back to Google's free favicon API.
 */
export async function fetchLogo(
  domain: string,
  size = 256,
): Promise<{ imageData: Buffer; mimeType: string; source: string }> {
  const logoDevKey = process.env.LOGO_DEV_API_KEY;

  // Try logo.dev first (higher quality, proper logos)
  if (logoDevKey) {
    try {
      const url = `https://img.logo.dev/${encodeURIComponent(domain)}?token=${logoDevKey}&size=${size}&format=png`;
      const res = await fetch(url);
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer());
        const mimeType = res.headers.get("content-type") || "image/png";
        return { imageData: buffer, mimeType, source: "logo.dev" };
      }
    } catch {
      // fall through to fallback
    }
  }

  // Fallback: Google favicon API (free, no key, max 256px)
  const url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${Math.min(size, 256)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Logo fetch failed for "${domain}" (${res.status})`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get("content-type") || "image/png";
  return { imageData: buffer, mimeType, source: "google-favicon" };
}

/**
 * Save a logo buffer to a project's media folder.
 * Returns the serving path.
 */
export async function saveLogoToProject(
  projectSlug: string,
  domain: string,
  imageData: Buffer,
  mimeType: string,
): Promise<string> {
  const mediaDir = path.join(PROJECTS_DIR, projectSlug, "media");
  ensureDir(mediaDir);
  const ext =
    mimeType.includes("jpeg") || mimeType.includes("jpg")
      ? ".jpg"
      : mimeType.includes("webp")
        ? ".webp"
        : ".png";
  const hash = crypto
    .createHash("md5")
    .update(imageData)
    .digest("hex")
    .slice(0, 8);
  const safeDomain = domain.replace(/[^a-z0-9.-]/gi, "_");
  const filename = `logo-${safeDomain}-${hash}${ext}`;

  const cdnUrl = await uploadBufferToBuilderCDN(filename, imageData, mimeType);

  const metadataPath = path.join(mediaDir, `${filename}.json`);
  const metadata = {
    filename,
    url: cdnUrl,
    type: "image",
    size: imageData.length,
    mimeType: mimeType,
    modifiedAt: Date.now(),
  };
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

  return cdnUrl;
}

/**
 * GET /api/clearbit/logo?domain=example.com&size=256&project=steve/my-project
 */
export const getClearbitLogo = defineEventHandler(async (event: H3Event) => {
  const query = getQuery(event);
  const domain = query.domain as string;
  const size = parseInt(query.size as string) || 256;
  const project = query.project as string | undefined;

  if (!domain?.trim()) {
    setResponseStatus(event, 400);
    return { error: "domain query param is required" };
  }

  try {
    const { imageData, mimeType, source } = await fetchLogo(
      domain.trim(),
      size,
    );

    let savedPath: string | undefined;
    if (project && isValidProjectPath(project)) {
      savedPath = await saveLogoToProject(
        project,
        domain.trim(),
        imageData,
        mimeType,
      );
    }

    return {
      savedPath,
      mimeType,
      domain: domain.trim(),
      source,
    };
  } catch (err: any) {
    setResponseStatus(event, 502);
    return { error: err.message || "Failed to fetch logo" };
  }
});
