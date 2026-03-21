import {
  defineEventHandler,
  readBody,
  setResponseStatus,
  type H3Event,
} from "h3";
import fs from "fs";
import path from "path";

const SELECTION_FILE = path.join(
  process.cwd(),
  "content",
  ".editor-selection.json",
);

export const saveSelection = defineEventHandler(async (event: H3Event) => {
  const {
    projectSlug,
    filePath,
    text,
    from,
    to,
    type,
    imageSrc,
    imageAlt,
    videoSrc,
  } = await readBody(event);

  if (!text || !filePath) {
    // Clear selection when no text is selected
    try {
      if (fs.existsSync(SELECTION_FILE)) {
        fs.unlinkSync(SELECTION_FILE);
      }
    } catch {
      // ignore
    }
    return { ok: true, cleared: true };
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
    return { ok: true };
  } catch (err: any) {
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

export const getSelection = defineEventHandler((event: H3Event) => {
  try {
    if (!fs.existsSync(SELECTION_FILE)) {
      return { selection: null };
    }

    const data = JSON.parse(fs.readFileSync(SELECTION_FILE, "utf-8"));

    // Check staleness (5 minutes)
    const age = Date.now() - new Date(data.timestamp).getTime();
    if (age > 5 * 60 * 1000) {
      fs.unlinkSync(SELECTION_FILE);
      return { selection: null, reason: "expired" };
    }

    return { selection: data };
  } catch (err: any) {
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});

export const clearSelection = defineEventHandler((event: H3Event) => {
  try {
    if (fs.existsSync(SELECTION_FILE)) {
      fs.unlinkSync(SELECTION_FILE);
    }
    return { ok: true };
  } catch (err: any) {
    setResponseStatus(event, 500);
    return { error: err.message };
  }
});
