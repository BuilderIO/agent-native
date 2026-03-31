import { defineEventHandler, readBody, setResponseStatus } from "h3";
import fs from "fs";
import path from "path";

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const vars = body?.vars as Array<{ key: string; value: string }> | undefined;

  if (!vars || !Array.isArray(vars) || vars.length === 0) {
    setResponseStatus(event, 400);
    return { error: "vars array is required" };
  }

  // Only allow known keys
  const allowed = new Set(["ATLASSIAN_CLIENT_ID", "ATLASSIAN_CLIENT_SECRET"]);
  const invalid = vars.filter((v) => !allowed.has(v.key));
  if (invalid.length > 0) {
    setResponseStatus(event, 400);
    return { error: `Invalid keys: ${invalid.map((v) => v.key).join(", ")}` };
  }

  // Read existing .env or create it
  const envPath = path.resolve(process.cwd(), ".env");
  let existing = "";
  try {
    existing = fs.readFileSync(envPath, "utf8");
  } catch {
    // File doesn't exist yet
  }

  const lines = existing.split("\n");
  const saved: string[] = [];

  for (const { key, value } of vars) {
    if (!value.trim()) continue;
    const idx = lines.findIndex(
      (l) => l.startsWith(`${key}=`) || l.startsWith(`${key} =`),
    );
    const line = `${key}=${value.trim()}`;
    if (idx >= 0) {
      lines[idx] = line;
    } else {
      lines.push(line);
    }
    // Also set in current process so the server picks it up immediately
    process.env[key] = value.trim();
    saved.push(key);
  }

  fs.writeFileSync(envPath, lines.filter((l) => l !== "").join("\n") + "\n");

  return { saved };
});
