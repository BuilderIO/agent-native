import type { Request, Response } from "express";
import path from "path";
import type { Settings } from "../../shared/api.js";
import { readJsonFile, writeJsonFile } from "../lib/data-helpers.js";

const SETTINGS_PATH = path.join(process.cwd(), "data", "settings.json");

const DEFAULT_SETTINGS: Settings = {
  timezone: "America/New_York",
  bookingPageTitle: "Book a Meeting",
  bookingPageDescription: "Select a time that works for you.",
  defaultEventDuration: 30,
};

export function getSettings(_req: Request, res: Response): void {
  try {
    const settings = readJsonFile<Settings>(SETTINGS_PATH) || DEFAULT_SETTINGS;
    res.json(settings);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

export function updateSettings(req: Request, res: Response): void {
  try {
    const settings: Settings = req.body;
    writeJsonFile(SETTINGS_PATH, settings);
    res.json(settings);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
