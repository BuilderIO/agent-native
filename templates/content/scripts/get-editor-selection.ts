import fs from "fs";
import path from "path";
import { loadEnv, CONTENT_DIR } from "./_utils.js";

const SELECTION_FILE = path.join(CONTENT_DIR, ".editor-selection.json");
const STALE_MS = 5 * 60 * 1000; // 5 minutes

export default async function main(_args: string[]) {
  loadEnv();

  if (!fs.existsSync(SELECTION_FILE)) {
    console.log("No text is currently selected in the editor.");
    return;
  }

  const data = JSON.parse(fs.readFileSync(SELECTION_FILE, "utf-8"));

  const age = Date.now() - new Date(data.timestamp).getTime();
  if (age > STALE_MS) {
    fs.unlinkSync(SELECTION_FILE);
    console.log(
      "No text is currently selected in the editor (previous selection expired).",
    );
    return;
  }

  let text = "## Editor Selection\n\n";
  text += `File: ${data.filePath}\n`;
  if (data.projectSlug) text += `Project: ${data.projectSlug}\n`;
  text += `Position: ${data.from} → ${data.to}\n\n`;
  text += `Selected text:\n\n> ${data.text.replace(/\n/g, "\n> ")}\n`;

  console.log(text);
}
