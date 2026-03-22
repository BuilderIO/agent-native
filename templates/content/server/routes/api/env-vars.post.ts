import { defineEventHandler, readBody, setResponseStatus } from "h3";
import type { H3Event } from "h3";
import fs from "fs";
import path from "path";

const ALLOWED_KEYS = new Set(["DATABASE_URL", "DATABASE_AUTH_TOKEN"]);

/**
 * Parse a .env file into key-value pairs, preserving comments and empty lines.
 */
function parseEnvFile(content: string): string[] {
  return content.split("\n");
}

/**
 * Upsert vars into a .env file, preserving existing structure.
 */
function upsertEnvFile(
  envPath: string,
  vars: Array<{ key: string; value: string }>,
): void {
  // Sanitize: reject values that could inject additional env vars
  for (const { key, value } of vars) {
    if (/[\r\n\0]/.test(value)) {
      throw new Error(
        `Invalid value for ${key}: contains newline or null byte`,
      );
    }
  }

  let lines: string[] = [];
  if (fs.existsSync(envPath)) {
    lines = parseEnvFile(fs.readFileSync(envPath, "utf-8"));
  }

  for (const { key, value } of vars) {
    const idx = lines.findIndex(
      (l) => l.startsWith(`${key}=`) || l.startsWith(`${key} =`),
    );
    const line = `${key}=${value}`;
    if (idx >= 0) {
      lines[idx] = line;
    } else {
      lines.push(line);
    }
  }

  // Ensure trailing newline
  const content = lines.join("\n").trimEnd() + "\n";
  fs.writeFileSync(envPath, content, "utf-8");
}

export default defineEventHandler(async (event: H3Event) => {
  const body = await readBody(event);
  const { vars } = body as {
    vars?: Array<{ key: string; value: string }>;
  };

  if (!vars || !Array.isArray(vars) || vars.length === 0) {
    setResponseStatus(event, 400);
    return { error: "Missing vars array" };
  }

  // Only allow recognized keys
  const filtered = vars.filter((v) => ALLOWED_KEYS.has(v.key));
  if (filtered.length === 0) {
    setResponseStatus(event, 400);
    return { error: "No recognized env keys in request" };
  }

  // Write to .env file
  const envPath = path.join(process.cwd(), ".env");
  upsertEnvFile(envPath, filtered);

  // Update process.env so the app picks up the new values immediately
  for (const { key, value } of filtered) {
    process.env[key] = value;
  }

  return { ok: true, updated: filtered.map((v) => v.key) };
});
