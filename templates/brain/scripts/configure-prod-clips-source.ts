import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { getDbExec } from "@agent-native/core/db";

const tokenFile = process.env.BRAIN_CLIPS_TOKEN_FILE;
if (!tokenFile) throw new Error("BRAIN_CLIPS_TOKEN_FILE is required");

const db = getDbExec();
const { rows } = await db.execute({
  sql: "SELECT id, source_key, config_json FROM brain_sources WHERE provider = ? AND title = ?",
  args: ["clips", "Clips exports"],
});
if (rows.length !== 1) {
  throw new Error(`Expected one Clips exports source, found ${rows.length}`);
}

const source = rows[0] as {
  id: string;
  source_key?: string | null;
  config_json?: string | null;
};
const sourceKey = source.source_key?.trim() || "clips";
const token = `brain_${randomBytes(32).toString("base64url")}`;
const tokenHash = createHash("sha256").update(token).digest("hex");
const config = JSON.parse(source.config_json || "{}") as Record<
  string,
  unknown
>;
config.sourceKey = sourceKey;
config.ingestTokenHash = tokenHash;

await db.execute({
  sql: "UPDATE brain_sources SET source_key = ?, ingest_token_hash = ?, config_json = ?, updated_at = ? WHERE id = ?",
  args: [
    sourceKey,
    tokenHash,
    JSON.stringify(config),
    new Date().toISOString(),
    source.id,
  ],
});
await writeFile(tokenFile, token, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o600,
});
console.log(
  JSON.stringify({ configured: true, sourceId: source.id, sourceKey }),
);
