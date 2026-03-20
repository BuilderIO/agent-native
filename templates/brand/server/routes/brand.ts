import {
  defineEventHandler,
  getQuery,
  readBody,
  getRouterParam,
  setResponseStatus,
  readMultipartFormData,
  sendStream,
  setResponseHeader,
  type H3Event,
} from "h3";
import type { Router } from "h3";
import fs from "fs";
import path from "path";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import type {
  AssetCategory,
  AssetInfo,
  BrandConfig,
  StyleProfile,
} from "@shared/types.js";

const BRAND_DIR = path.join(process.cwd(), "data", "brand");

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
];
const ALLOWED_FONT_TYPES = [
  "font/woff",
  "font/woff2",
  "font/ttf",
  "font/otf",
  "application/font-woff",
  "application/x-font-ttf",
];

const VALID_CATEGORIES = new Set<AssetCategory>(["logos", "references"]);

function isValidCategory(cat: string): cat is AssetCategory {
  return VALID_CATEGORIES.has(cat as AssetCategory);
}

function isSafePath(base: string, ...segments: string[]): boolean {
  const resolved = path.resolve(base, ...segments);
  return resolved.startsWith(path.resolve(base));
}

// GET /api/brand/config
export const getConfig = defineEventHandler(async (_event: H3Event) => {
  const configPath = path.join(BRAND_DIR, "config.json");
  if (!fs.existsSync(configPath)) {
    return { name: "", description: "", colors: {}, fonts: {} };
  }
  return JSON.parse(fs.readFileSync(configPath, "utf-8")) as BrandConfig;
});

// PUT /api/brand/config
export const putConfig = defineEventHandler(async (event: H3Event) => {
  const configPath = path.join(BRAND_DIR, "config.json");
  const config = (await readBody(event)) as BrandConfig;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return config;
});

// GET /api/brand/style-profile
export const getStyleProfile = defineEventHandler(async (_event: H3Event) => {
  const profilePath = path.join(BRAND_DIR, "style-profile.json");
  if (!fs.existsSync(profilePath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(profilePath, "utf-8")) as StyleProfile;
});

// POST /api/brand/upload?category=logos|references
export const uploadAsset = defineEventHandler(async (event: H3Event) => {
  const category = getQuery(event).category as string;
  if (!isValidCategory(category)) {
    setResponseStatus(event, 400);
    return { error: `Invalid category: ${category}` };
  }

  const parts = await readMultipartFormData(event);
  const filePart = parts?.find((p) => p.name === "file");
  if (!filePart || !filePart.data) {
    setResponseStatus(event, 400);
    return { error: "No file uploaded" };
  }

  const mimeType = filePart.type ?? "";
  if (![...ALLOWED_IMAGE_TYPES, ...ALLOWED_FONT_TYPES].includes(mimeType)) {
    setResponseStatus(event, 400);
    return { error: `File type ${mimeType} not allowed` };
  }

  const dir = path.join(BRAND_DIR, category);
  fs.mkdirSync(dir, { recursive: true });

  const originalName = filePart.filename ?? "upload";
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `${base}-${Date.now()}${ext}`;

  if (filePart.data.length > 10 * 1024 * 1024) {
    setResponseStatus(event, 400);
    return { error: "File too large (max 10MB)" };
  }

  fs.writeFileSync(path.join(dir, filename), filePart.data);

  return {
    filename,
    category,
    url: `/api/brand/files/${category}/${filename}`,
  };
});

// GET /api/brand/assets?category=logos|references (or all if omitted)
export const listAssets = defineEventHandler(async (event: H3Event) => {
  const category = getQuery(event).category as AssetCategory | undefined;
  const categories: AssetCategory[] = category
    ? [category]
    : ["logos", "references"];
  const assets: AssetInfo[] = [];

  for (const cat of categories) {
    const dir = path.join(BRAND_DIR, cat);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f !== ".gitkeep");
    for (const filename of files) {
      const s = fs.statSync(path.join(dir, filename));
      assets.push({
        filename,
        category: cat,
        url: `/api/brand/files/${cat}/${filename}`,
        size: s.size,
        modifiedAt: s.mtimeMs,
      });
    }
  }

  return assets;
});

// DELETE /api/brand/assets/:category/:filename
export const deleteAsset = defineEventHandler(async (event: H3Event) => {
  const category = getRouterParam(event, "category") as string;
  const filename = getRouterParam(event, "filename") as string;
  if (!isSafePath(BRAND_DIR, category, filename)) {
    setResponseStatus(event, 400);
    return { error: "Invalid path" };
  }
  const filePath = path.join(BRAND_DIR, category, filename);
  if (!fs.existsSync(filePath)) {
    setResponseStatus(event, 404);
    return { error: "File not found" };
  }
  fs.unlinkSync(filePath);
  return { deleted: true };
});

// GET /api/brand/files/** — serve static brand asset files
export const serveBrandFile = defineEventHandler(async (event: H3Event) => {
  const filePath = event.path.replace("/api/brand/files/", "");
  const fullPath = path.join(BRAND_DIR, filePath);
  if (!isSafePath(BRAND_DIR, filePath)) {
    setResponseStatus(event, 400);
    return { error: "Invalid path" };
  }
  try {
    await stat(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".svg": "image/svg+xml",
      ".webp": "image/webp",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
      ".otf": "font/otf",
    };
    const mimeType = mimeMap[ext] ?? "application/octet-stream";
    setResponseHeader(event, "Content-Type", mimeType);
    setResponseHeader(event, "Cache-Control", "public, max-age=3600");
    return sendStream(event, createReadStream(fullPath));
  } catch {
    setResponseStatus(event, 404);
    return { error: "Not found" };
  }
});

export function registerBrandRoutes(router: Router) {
  router.get("/api/brand/config", getConfig);
  router.put("/api/brand/config", putConfig);
  router.get("/api/brand/style-profile", getStyleProfile);
  router.post("/api/brand/upload", uploadAsset);
  router.get("/api/brand/assets", listAssets);
  router.delete("/api/brand/assets/:category/:filename", deleteAsset);
  router.get("/api/brand/files/**", serveBrandFile);
}
