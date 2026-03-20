import fs from "fs";
import path from "path";
import {
  defineEventHandler,
  getQuery,
  readBody,
  getRouterParam,
  setResponseStatus,
  readMultipartFormData,
  type H3Event,
} from "h3";
import type { Router } from "h3";
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

export function registerBrandRoutes(router: Router) {
  router.get("/api/brand/config", getBrandConfig);
  router.put("/api/brand/config", updateBrandConfig);
  router.get("/api/brand/style-profile", getStyleProfile);
  router.post("/api/brand/upload", uploadBrandAsset);
  router.get("/api/brand/assets", listBrandAssets);
  router.delete("/api/brand/assets/:category/:filename", deleteBrandAsset);
}

// GET /api/brand/config
export const getBrandConfig = defineEventHandler(async (_event: H3Event) => {
  const configPath = path.join(BRAND_DIR, "config.json");
  if (!fs.existsSync(configPath)) {
    return { name: "", description: "", colors: {}, fonts: {} };
  }
  const data = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  return data as BrandConfig;
});

// PUT /api/brand/config
export const updateBrandConfig = defineEventHandler(async (event: H3Event) => {
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
  const data = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
  return data as StyleProfile;
});

// POST /api/brand/upload?category=logos|references
export const uploadBrandAsset = defineEventHandler(async (event: H3Event) => {
  const query = getQuery(event);
  const category = query.category as string;

  if (!isValidCategory(category)) {
    setResponseStatus(event, 400);
    return { error: `Invalid category: ${category}` };
  }

  const parts = await readMultipartFormData(event);
  const filePart = parts?.find((p) => p.name === "file");

  if (!filePart?.data) {
    setResponseStatus(event, 400);
    return { error: "No file uploaded" };
  }

  const contentType = filePart.type ?? "";
  if (![...ALLOWED_IMAGE_TYPES, ...ALLOWED_FONT_TYPES].includes(contentType)) {
    setResponseStatus(event, 400);
    return { error: `File type ${contentType} not allowed` };
  }

  const originalName = filePart.filename ?? "upload";
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `${base}-${Date.now()}${ext}`;

  const dir = path.join(BRAND_DIR, category);
  fs.mkdirSync(dir, { recursive: true });

  const destPath = path.join(dir, filename);
  fs.writeFileSync(destPath, filePart.data);

  return {
    filename,
    category: category as AssetCategory,
    url: `/api/brand/files/${category}/${filename}`,
  };
});

// GET /api/brand/assets?category=logos|references (or all if omitted)
export const listBrandAssets = defineEventHandler(async (event: H3Event) => {
  const query = getQuery(event);
  const category = query.category as AssetCategory | undefined;
  const categories: AssetCategory[] = category
    ? [category]
    : ["logos", "references"];
  const assets: AssetInfo[] = [];

  for (const cat of categories) {
    const dir = path.join(BRAND_DIR, cat);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f !== ".gitkeep");
    for (const filename of files) {
      const stat = fs.statSync(path.join(dir, filename));
      assets.push({
        filename,
        category: cat,
        url: `/api/brand/files/${cat}/${filename}`,
        size: stat.size,
        modifiedAt: stat.mtimeMs,
      });
    }
  }

  return assets;
});

// DELETE /api/brand/assets/:category/:filename
export const deleteBrandAsset = defineEventHandler(async (event: H3Event) => {
  const category = getRouterParam(event, "category") ?? "";
  const filename = getRouterParam(event, "filename") ?? "";

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
