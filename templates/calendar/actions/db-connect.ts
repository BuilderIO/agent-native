/**
 * Configure a remote database connection
 *
 * Usage:
 *   pnpm action db-connect --url "libsql://your-db.turso.io" --token "your-auth-token"
 *
 * Options:
 *   --url    DATABASE_URL (required)
 *   --token  DATABASE_AUTH_TOKEN (optional, required for most remote providers)
 *
 * Writes the values to .env and verifies the connection.
 */

const config = async () => {
  try {
    const m = await import("dotenv");
    m.config();
  } catch {}
};
import { readFileSync, writeFileSync, existsSync } from "fs";
import { agentChat } from "@agent-native/core";
import { parseArgs } from "./helpers.js";

function upsertEnvLine(content: string, key: string, value: string): string {
  // Reject values with newlines or null bytes
  if (/[\r\n\0]/.test(value)) {
    throw new Error(`Invalid value for ${key}: contains newline or null byte`);
  }

  const regex = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  if (regex.test(content)) {
    return content.replace(regex, line);
  }
  return content.trimEnd() + "\n" + line + "\n";
}

export default async function main(args: string[]) {
  await config();

  const opts = parseArgs(args);

  if (!opts["url"]) {
    console.error("Error: --url is required (e.g., libsql://your-db.turso.io)");
    process.exit(1);
  }

  const url = opts["url"];
  const token = opts["token"] || "";

  // Test the connection first
  const maskedUrl = url.replace(/\/\/.*@/, "//***@");
  console.log(`Testing connection to ${maskedUrl}...`);
  try {
    const { createClient } = await import("@libsql/client");
    const client = createClient({ url, authToken: token || undefined });
    await client.execute("SELECT 1");
    console.log("Connection successful!");
  } catch (err: any) {
    console.error(`Connection failed: ${err.message}`);
    agentChat.submit(
      `Failed to connect to database at ${maskedUrl}: ${err.message}`,
    );
    process.exit(1);
  }

  // Write to .env
  const envPath = ".env";
  let envContent = "";
  if (existsSync(envPath)) {
    envContent = readFileSync(envPath, "utf-8");
  }

  envContent = upsertEnvLine(envContent, "DATABASE_URL", url);
  if (token) {
    envContent = upsertEnvLine(envContent, "DATABASE_AUTH_TOKEN", token);
  }

  writeFileSync(envPath, envContent);
  console.log(
    "Updated .env with DATABASE_URL" +
      (token ? " and DATABASE_AUTH_TOKEN" : ""),
  );
  console.log("");
  console.log("Restart the server to use the new database connection.");

  agentChat.submit(
    `Database connection configured: ${maskedUrl}. Restart the server to apply.`,
  );
}
