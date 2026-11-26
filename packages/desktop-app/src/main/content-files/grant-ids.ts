import { createHmac, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ID_KEY_FILE = "content-file-id-key";
const ID_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

interface LinkedFolder {
  id: string;
  path: string;
  kind: "persistent" | "temporary";
}

export function contentFilesIdKey(directory: string): string {
  const file = path.join(directory, ID_KEY_FILE);
  if (fs.existsSync(file)) {
    const stored = fs.readFileSync(file, "utf-8").trim();
    if (ID_KEY_PATTERN.test(stored)) return stored;
    const keptAside = `${file}.unreadable-${Date.now()}`;
    fs.renameSync(file, keptAside);
    console.warn("[content-files] replaced an unreadable folder id key", {
      keptAside,
    });
  }
  const key = randomBytes(32).toString("base64url");
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, key, {
    encoding: "utf-8",
    mode: 0o600,
    flag: "wx",
  });
  fs.renameSync(temporary, file);
  return key;
}

export function legacyContentFilesGrantId(folder: string): string {
  return `folder-${Buffer.from(path.resolve(folder)).toString("base64url")}`;
}

export function persistentContentFilesGrantId(
  folder: string,
  grants: Record<string, LinkedFolder>,
  key: string,
): string {
  const resolved = path.resolve(folder);
  const existing = Object.values(grants).find(
    (grant) => grant.kind !== "temporary" && grant.path === resolved,
  );
  if (existing) return existing.id;
  const digest = createHmac("sha256", key).update(resolved).digest("base64url");
  return `folder-${digest.slice(0, 32)}`;
}
