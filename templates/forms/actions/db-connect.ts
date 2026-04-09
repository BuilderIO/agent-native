import { defineAction } from "@agent-native/core";
import fs from "fs";
import path from "path";
import { z } from "zod";

function upsertEnvLine(lines: string[], key: string, value: string): string[] {
  if (/[\r\n\0]/.test(value)) {
    throw new Error(
      `Invalid value for ${key}: must not contain newlines or null bytes`,
    );
  }

  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  const line = `${key}=${value}`;
  if (idx >= 0) {
    lines[idx] = line;
  } else {
    lines.push(line);
  }
  return lines;
}

export default defineAction({
  description:
    "Write DATABASE_URL and optional DATABASE_AUTH_TOKEN to .env file.",
  schema: z.object({
    url: z.string().describe("DATABASE_URL value (required)"),
    token: z.string().optional().describe("DATABASE_AUTH_TOKEN value"),
  }),
  http: false,
  run: async (args) => {
    const envPath = path.join(process.cwd(), ".env");
    let lines: string[] = [];

    if (fs.existsSync(envPath)) {
      lines = fs.readFileSync(envPath, "utf8").split("\n");
    }

    upsertEnvLine(lines, "DATABASE_URL", args.url);
    if (args.token) {
      upsertEnvLine(lines, "DATABASE_AUTH_TOKEN", args.token);
    }

    fs.writeFileSync(envPath, lines.join("\n"));

    return `Database connection saved to .env. Restart the dev server for changes to take effect.`;
  },
});
