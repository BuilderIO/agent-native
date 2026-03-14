import { RequestHandler } from "express";
import fs from "fs";
import path from "path";

const SELECTION_FILE = path.join(process.cwd(), "content", ".editor-selection.json");

export const saveSelection: RequestHandler = (req, res) => {
  const { projectSlug, filePath, text, from, to, type, imageSrc, imageAlt, videoSrc } = req.body;

  if (!text || !filePath) {
    // Clear selection when no text is selected
    try {
      if (fs.existsSync(SELECTION_FILE)) {
        fs.unlinkSync(SELECTION_FILE);
      }
    } catch {
      // ignore
    }
    res.json({ ok: true, cleared: true });
    return;
  }

  const data: Record<string, unknown> = {
    projectSlug: projectSlug || null,
    filePath,
    text,
    type: type || "text",
    from,
    to,
    timestamp: new Date().toISOString(),
  };
  if (imageSrc) data.imageSrc = imageSrc;
  if (imageAlt) data.imageAlt = imageAlt;
  if (videoSrc) data.videoSrc = videoSrc;

  try {
    fs.writeFileSync(SELECTION_FILE, JSON.stringify(data, null, 2), "utf-8");
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const getSelection: RequestHandler = (_req, res) => {
  try {
    if (!fs.existsSync(SELECTION_FILE)) {
      res.json({ selection: null });
      return;
    }

    const data = JSON.parse(fs.readFileSync(SELECTION_FILE, "utf-8"));

    // Check staleness (5 minutes)
    const age = Date.now() - new Date(data.timestamp).getTime();
    if (age > 5 * 60 * 1000) {
      fs.unlinkSync(SELECTION_FILE);
      res.json({ selection: null, reason: "expired" });
      return;
    }

    res.json({ selection: data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

export const clearSelection: RequestHandler = (_req, res) => {
  try {
    if (fs.existsSync(SELECTION_FILE)) {
      fs.unlinkSync(SELECTION_FILE);
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};
