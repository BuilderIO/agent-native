import { getDbExec } from "@agent-native/core/db";

const BATCH_SIZE = 100;

type LegacyAsset = {
  id: string;
  design_id: string;
  file_id: string;
  provider_url: string;
  uploader_email: string;
  mime_type: string;
  byte_length: number;
  sha256: string;
  created_at: string | null;
};

export async function backfillDesignNativeTextureObjectsBatch(): Promise<{
  migrated: number;
  complete: boolean;
}> {
  const transaction = getDbExec().transaction;
  if (!transaction)
    throw new Error("Native texture backfill requires SQL transactions.");
  return transaction(async (tx) => {
    // guard:allow-unscoped — explicit privileged CLI migration scans bounded legacy rows across owners, never a request or raw DB tool.
    const selected = await tx.execute({
      sql: `SELECT old.id, old.design_id, old.file_id, old.provider_url,
          old.uploader_email, old.mime_type, old.byte_length, old.sha256,
          old.created_at
        FROM design_native_texture_assets old
        LEFT JOIN design_native_texture_objects object ON object.id = old.id
        LEFT JOIN design_native_texture_bindings binding
          ON binding.asset_id = old.id AND binding.design_id = old.design_id
          AND binding.file_id = old.file_id
        WHERE object.id IS NULL OR binding.asset_id IS NULL
        ORDER BY old.id LIMIT ? FOR UPDATE OF old`,
      args: [BATCH_SIZE],
    });
    for (const row of selected.rows as LegacyAsset[]) {
      await tx.execute({
        sql: `INSERT INTO design_native_texture_objects
          (id, provider_url, uploader_email, mime_type, byte_length, sha256, created_at)
          VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP::text))
          ON CONFLICT (id) DO NOTHING`,
        args: [
          row.id,
          row.provider_url,
          row.uploader_email,
          row.mime_type,
          row.byte_length,
          row.sha256,
          row.created_at,
        ],
      });
      const checked = await tx.execute({
        sql: `SELECT id FROM design_native_texture_objects
          WHERE id = ? AND provider_url = ? AND uploader_email = ?
            AND mime_type = ? AND byte_length = ? AND sha256 = ?`,
        args: [
          row.id,
          row.provider_url,
          row.uploader_email,
          row.mime_type,
          row.byte_length,
          row.sha256,
        ],
      });
      if (checked.rows.length !== 1)
        throw new Error(
          "Native texture object metadata changed during backfill.",
        );
      await tx.execute({
        sql: `INSERT INTO design_native_texture_bindings(asset_id, design_id, file_id)
          VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
        args: [row.id, row.design_id, row.file_id],
      });
    }
    return {
      migrated: selected.rows.length,
      complete: selected.rows.length < BATCH_SIZE,
    };
  });
}
