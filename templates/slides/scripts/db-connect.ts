import fs from "fs";
import path from "path";

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        result[key] = next;
        i++;
      } else {
        result[key] = "true";
      }
    }
  }
  return result;
}

function upsertEnvLine(lines: string[], key: string, value: string): string[] {
  // Reject values with newlines, carriage returns, or null bytes
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

export default async function main(args: string[]) {
  const { url, token, help } = parseArgs(args);

  if (help) {
    console.log(
      "Usage: pnpm script db-connect --url <DATABASE_URL> [--token <DATABASE_AUTH_TOKEN>]",
    );
    console.log("\nWrites DATABASE_URL and DATABASE_AUTH_TOKEN to .env");
    return;
  }

  if (!url) {
    console.error("Error: --url is required");
    process.exit(1);
  }

  const envPath = path.join(process.cwd(), ".env");
  let lines: string[] = [];

  if (fs.existsSync(envPath)) {
    lines = fs.readFileSync(envPath, "utf8").split("\n");
  }

  try {
    upsertEnvLine(lines, "DATABASE_URL", url);
    if (token) {
      upsertEnvLine(lines, "DATABASE_AUTH_TOKEN", token);
    }
  } catch (err) {
    console.error(
      `Error: ${err instanceof Error ? err.message : "Invalid value"}`,
    );
    process.exit(1);
  }

  fs.writeFileSync(envPath, lines.join("\n"));

  console.log(`\nDatabase connection saved to .env`);
  console.log(
    `  DATABASE_URL=${url.startsWith("file:") ? url : url.replace(/\/\/.*@/, "//***@")}`,
  );
  if (token) console.log(`  DATABASE_AUTH_TOKEN=***`);
  console.log(`\nRestart the dev server for changes to take effect.`);
}
