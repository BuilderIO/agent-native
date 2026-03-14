import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import type {
  AssetCategory,
  AssetInfo,
  BrandConfig,
  StyleProfile,
} from "@shared/types.js";

const BRAND_DIR = path.join(process.cwd(), "data", "brand");

// Multer config for brand asset uploads
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const category = req.query.category as string;
    if (!isValidCategory(category)) {
      cb(new Error(`Invalid category: ${category}`), "");
      return;
    }
    const dir = path.join(BRAND_DIR, category);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, "_");
    cb(null, `${base}-${Date.now()}${ext}`);
  },
});

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

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (
      [...ALLOWED_IMAGE_TYPES, ...ALLOWED_FONT_TYPES].includes(file.mimetype)
    ) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  },
});

const VALID_CATEGORIES = new Set<AssetCategory>(["logos", "references"]);

function isValidCategory(cat: string): cat is AssetCategory {
  return VALID_CATEGORIES.has(cat as AssetCategory);
}

function isSafePath(base: string, ...segments: string[]): boolean {
  const resolved = path.resolve(base, ...segments);
  return resolved.startsWith(path.resolve(base));
}

export const brandRouter = Router();

// GET /api/brand/config
brandRouter.get("/config", (_req, res) => {
  const configPath = path.join(BRAND_DIR, "config.json");
  if (!fs.existsSync(configPath)) {
    res.json({ name: "", description: "", colors: {}, fonts: {} });
    return;
  }
  const data = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  res.json(data as BrandConfig);
});

// PUT /api/brand/config
brandRouter.put("/config", (req, res) => {
  const configPath = path.join(BRAND_DIR, "config.json");
  const config = req.body as BrandConfig;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  res.json(config);
});

// GET /api/brand/style-profile
brandRouter.get("/style-profile", (_req, res) => {
  const profilePath = path.join(BRAND_DIR, "style-profile.json");
  if (!fs.existsSync(profilePath)) {
    res.json({});
    return;
  }
  const data = JSON.parse(fs.readFileSync(profilePath, "utf-8"));
  res.json(data as StyleProfile);
});

// POST /api/brand/upload?category=logos|references
brandRouter.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const category = req.query.category as AssetCategory;
  res.json({
    filename: req.file.filename,
    category,
    url: `/api/brand/files/${category}/${req.file.filename}`,
  });
});

// GET /api/brand/assets?category=logos|references (or all if omitted)
brandRouter.get("/assets", (req, res) => {
  const category = req.query.category as AssetCategory | undefined;
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

  res.json(assets);
});

// DELETE /api/brand/assets/:category/:filename
brandRouter.delete("/assets/:category/:filename", (req, res) => {
  const { category, filename } = req.params;
  if (!isSafePath(BRAND_DIR, category, filename)) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }
  const filePath = path.join(BRAND_DIR, category, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  fs.unlinkSync(filePath);
  res.json({ deleted: true });
});
