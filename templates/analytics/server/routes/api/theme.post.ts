import path from "path";
import fs from "fs";
import { defineEventHandler, readBody } from "h3";

const mediaDir = path.resolve(import.meta.dirname, "../../../media");
const themeFile = path.join(mediaDir, "theme.json");

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const theme = body?.theme === "light" ? "light" : "dark";
  if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
  fs.writeFileSync(themeFile, JSON.stringify({ theme }));
  return { theme };
});
