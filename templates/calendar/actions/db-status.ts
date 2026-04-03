/**
 * Check database connection status
 *
 * Usage:
 *   pnpm action db-status
 *
 * Reports whether the database is local or remote, and whether it's reachable.
 */

const config = async () => {
  try {
    const m = await import("dotenv");
    m.config();
  } catch {}
};
import { agentChat } from "@agent-native/core";

export default async function main(_args: string[]) {
  await config();

  const url = process.env.DATABASE_URL || "file:./data/app.db";
  const isLocal = url.startsWith("file:");

  console.log(
    `Database URL: ${isLocal ? url : url.replace(/\/\/.*@/, "//***@")}`,
  );
  console.log(`Mode: ${isLocal ? "local" : "remote"}`);
  console.log("");

  try {
    const { createClient } = await import("@libsql/client");
    const client = createClient({
      url,
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });

    await client.execute("SELECT 1");
    console.log("Status: Connected");

    // Show tables
    const result = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '__%' ORDER BY name",
    );
    const tables = result.rows.map((r) => r.name as string);
    console.log(`Tables: ${tables.join(", ") || "(none)"}`);

    agentChat.submit(
      `Database is ${isLocal ? "local" : "remote"} and connected. Tables: ${tables.join(", ") || "none"}.`,
    );
  } catch (err: any) {
    console.error(`Status: Disconnected`);
    console.error(`Error: ${err.message}`);
    agentChat.submit(
      `Database connection failed: ${err.message}. Mode: ${isLocal ? "local" : "remote"}.`,
    );
    process.exit(1);
  }
}
