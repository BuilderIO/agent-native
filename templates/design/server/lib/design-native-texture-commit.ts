import { getDbExec } from "@agent-native/core/db";
import { UPLOAD_RECEIPT_PREFIX } from "@agent-native/core/file-upload/actions/upload-image";

type Registration = {
  id: string;
  designId: string;
  fileId: string;
  idempotencyKey: string;
  uploaderEmail: string;
  ownerEmail: string;
  orgId: string | null;
  receiptKey: string;
  providerUrl: string;
  mimeType: string;
  byteLength: number;
  sha256: string;
};

type Stored = {
  id: string;
  provider_url: string;
  mime_type: string;
  sha256: string;
  uploader_email: string;
  byte_length: number;
};

type Receipt = {
  status: string;
  url: string;
  ownerEmail?: string;
  expiresAt: number;
  [key: string]: unknown;
};

export class NativeTextureCommitError extends Error {
  constructor(
    readonly code:
      | "receipt-unavailable"
      | "receipt-mismatch"
      | "registration-conflict",
  ) {
    super(`Native texture commit ${code}`);
  }
}

export async function commitDesignNativeTextureRegistration(
  input: Registration,
): Promise<{
  id: string;
  sameProviderObject: boolean;
}> {
  const client = getDbExec();
  if (!client.transaction)
    throw new Error("Native texture commit requires SQL transactions.");
  return client.transaction(async (tx) => {
    const ensureSharedRetention = async (row: Stored) => {
      await tx.execute({
        sql: `INSERT INTO design_native_texture_objects
          (id, provider_url, uploader_email, mime_type, byte_length, sha256)
          VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
        args: [
          row.id,
          row.provider_url,
          row.uploader_email,
          row.mime_type,
          row.byte_length,
          row.sha256,
        ],
      });
      const existing = await tx.execute({
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
      if (existing.rows.length !== 1)
        throw new NativeTextureCommitError("registration-conflict");
      await tx.execute({
        sql: `INSERT INTO design_native_texture_bindings
          (asset_id, design_id, file_id) VALUES (?, ?, ?)
          ON CONFLICT DO NOTHING`,
        args: [row.id, input.designId, input.fileId],
      });
    };
    const stateKey = `${UPLOAD_RECEIPT_PREFIX}${input.receiptKey}`;
    const locked = await tx.execute({
      sql: "SELECT value FROM application_state WHERE session_id = ? AND key = ? FOR UPDATE",
      args: [input.uploaderEmail, stateKey],
    });
    if (locked.rows.length !== 1 || typeof locked.rows[0]?.value !== "string")
      throw new NativeTextureCommitError("receipt-unavailable");
    const storedValue = locked.rows[0].value;
    let receipt: Receipt;
    try {
      receipt = JSON.parse(storedValue) as Receipt;
    } catch {
      throw new NativeTextureCommitError("receipt-unavailable");
    }
    if (
      !receipt ||
      !["staged", "committed"].includes(receipt.status) ||
      receipt.url !== input.providerUrl ||
      receipt.ownerEmail !== input.uploaderEmail ||
      !Number.isFinite(receipt.expiresAt)
    )
      throw new NativeTextureCommitError("receipt-mismatch");

    if (receipt.status === "committed") {
      const existing = await tx.execute({
        sql: `SELECT id, provider_url, mime_type, sha256, uploader_email, byte_length
          FROM design_native_texture_assets
          WHERE design_id = ? AND file_id = ? AND idempotency_key = ?`,
        args: [input.designId, input.fileId, input.idempotencyKey],
      });
      const row = existing.rows[0] as Stored | undefined;
      if (
        !row ||
        row.provider_url !== input.providerUrl ||
        row.mime_type !== input.mimeType ||
        row.sha256 !== input.sha256
      )
        throw new NativeTextureCommitError("registration-conflict");
      await ensureSharedRetention(row);
      return { id: row.id, sameProviderObject: true };
    }

    await tx.execute({
      sql: `INSERT INTO design_native_texture_assets
        (id, design_id, file_id, idempotency_key, uploader_email,
         owner_email, org_id, visibility, provider_url, mime_type, byte_length, sha256)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'private', ?, ?, ?, ?)
        ON CONFLICT (design_id, file_id, idempotency_key) DO NOTHING`,
      args: [
        input.id,
        input.designId,
        input.fileId,
        input.idempotencyKey,
        input.uploaderEmail,
        input.ownerEmail,
        input.orgId,
        input.providerUrl,
        input.mimeType,
        input.byteLength,
        input.sha256,
      ],
    });
    const selected = await tx.execute({
      sql: `SELECT id, provider_url, mime_type, sha256, uploader_email, byte_length
        FROM design_native_texture_assets
        WHERE design_id = ? AND file_id = ? AND idempotency_key = ?`,
      args: [input.designId, input.fileId, input.idempotencyKey],
    });
    const row = selected.rows[0] as Stored | undefined;
    if (!row || row.mime_type !== input.mimeType || row.sha256 !== input.sha256)
      throw new NativeTextureCommitError("registration-conflict");
    await ensureSharedRetention(row);
    if (row.provider_url !== input.providerUrl)
      return { id: row.id, sameProviderObject: false };

    const committed: Receipt = {
      ...receipt,
      status: "committed",
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };
    const updated = await tx.execute({
      sql: `UPDATE application_state SET value = ?, updated_at = ?
        WHERE session_id = ? AND key = ? AND value = ? RETURNING key`,
      args: [
        JSON.stringify(committed),
        Date.now(),
        input.uploaderEmail,
        stateKey,
        storedValue,
      ],
    });
    if (updated.rows.length !== 1)
      throw new NativeTextureCommitError("receipt-mismatch");
    return { id: row.id, sameProviderObject: true };
  });
}
