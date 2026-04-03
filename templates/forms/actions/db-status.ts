import { createClient } from "@libsql/client";

export default async function main() {
  const url = process.env.DATABASE_URL || "file:./data/app.db";
  const isLocal = url.startsWith("file:");

  console.log(`\nDatabase Status`);
  console.log(`  URL: ${isLocal ? url : url.replace(/\/\/.*@/, "//***@")}`);
  console.log(`  Mode: ${isLocal ? "local (SQLite file)" : "remote (cloud)"}`);

  try {
    const client = createClient({
      url,
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });
    const result = await client.execute("SELECT 1 as ok");
    if (result.rows.length > 0) {
      console.log(`  Status: connected`);
    } else {
      console.log(`  Status: unexpected response`);
    }
  } catch (err) {
    console.error(
      `  Status: error — ${err instanceof Error ? err.message : "Unknown"}`,
    );
    throw new Error("Script failed");
  }
}
