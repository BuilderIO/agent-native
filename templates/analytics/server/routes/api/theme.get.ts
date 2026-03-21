import path from "path";
import fs from "fs";
import { defineEventHandler } from "h3";

const mediaDir = path.resolve(import.meta.dirname, "../../../media");
const themeFile = path.join(mediaDir, "theme.json");

export default defineEventHandler(() => {
  try {
    if (fs.existsSync(themeFile)) {
      return JSON.parse(fs.readFileSync(themeFile, "utf8"));
    }
    return { theme: "dark" };
  } catch {
    return { theme: "dark" };
  }
});
