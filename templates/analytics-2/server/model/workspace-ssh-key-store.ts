import { generateKeyPairSync, randomUUID } from "node:crypto";

import { deleteAppSecret, writeAppSecret } from "@agent-native/core/secrets";
import { getOrgSetting, mutateOrgSetting } from "@agent-native/core/settings";
import { z } from "zod";

import type { WorkspaceSshKey } from "../../app/lib/model/workspace-ssh-key-contracts.js";

const SETTING_KEY = "analytics.workspaceSshKey";
const PRIVATE_KEY_SECRET_PREFIX = "analytics.workspaceSshPrivateKey.";
const SSH_KEY_TYPE = "ssh-ed25519";

const storedWorkspaceSshKeySchema = z
  .object({
    id: z.string().min(1),
    sshPublicKey: z.string().min(1),
    createdAt: z.string().min(1),
  })
  .strict();

type StoredWorkspaceSshKey = z.infer<typeof storedWorkspaceSshKeySchema>;

function encodeSshString(data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, data]);
}

function generateWorkspaceSshKeyPair(): {
  record: StoredWorkspaceSshKey;
  privateKeyPem: string;
} {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" });
  if (typeof jwk.x !== "string") {
    throw new Error("Failed to export Ed25519 public key.");
  }
  const rawPublicKey = Buffer.from(jwk.x, "base64url");
  if (rawPublicKey.length !== 32) {
    throw new Error("Unexpected Ed25519 public key length.");
  }
  const wire = Buffer.concat([
    encodeSshString(Buffer.from(SSH_KEY_TYPE, "ascii")),
    encodeSshString(rawPublicKey),
  ]);
  const privateKeyPem = privateKey.export({
    format: "pem",
    type: "pkcs8",
  });
  if (typeof privateKeyPem !== "string") {
    throw new Error("Failed to export Ed25519 private key.");
  }
  return {
    record: {
      id: randomUUID(),
      sshPublicKey: `${SSH_KEY_TYPE} ${wire.toString("base64")}`,
      createdAt: new Date().toISOString(),
    },
    privateKeyPem,
  };
}

function toPublicSshKey(record: StoredWorkspaceSshKey): WorkspaceSshKey {
  return {
    id: record.id,
    sshPublicKey: record.sshPublicKey,
  };
}

function parseStoredSshKey(
  value: Record<string, unknown> | null,
): StoredWorkspaceSshKey | null {
  const parsed = storedWorkspaceSshKeySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function getOrCreateWorkspaceSshKey(
  orgId: string,
): Promise<WorkspaceSshKey> {
  const existing = parseStoredSshKey(await getOrgSetting(orgId, SETTING_KEY));
  if (existing) return toPublicSshKey(existing);

  const generated = generateWorkspaceSshKeyPair();
  const secretRef = {
    key: `${PRIVATE_KEY_SECRET_PREFIX}${generated.record.id}`,
    scope: "org" as const,
    scopeId: orgId,
  };
  await writeAppSecret({
    ...secretRef,
    value: generated.privateKeyPem,
  });

  let won = false;
  let resolved: StoredWorkspaceSshKey = generated.record;
  try {
    await mutateOrgSetting(orgId, SETTING_KEY, (current) => {
      const stored = parseStoredSshKey(current);
      if (stored) {
        resolved = stored;
        won = false;
        return stored;
      }
      resolved = generated.record;
      won = true;
      return generated.record;
    });
  } catch (error) {
    await deleteAppSecret(secretRef).catch(() => undefined);
    throw error;
  }

  if (!won) {
    await deleteAppSecret(secretRef).catch(() => undefined);
  }
  return toPublicSshKey(resolved);
}
