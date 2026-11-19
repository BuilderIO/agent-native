import { randomUUID } from "node:crypto";
import path from "node:path";

interface LinkedFolder {
  id: string;
  path: string;
  kind: "persistent" | "temporary";
}

export function legacyContentFilesGrantId(folder: string): string {
  return `folder-${Buffer.from(path.resolve(folder)).toString("base64url")}`;
}

export function persistentContentFilesGrantId(
  folder: string,
  grants: Record<string, LinkedFolder>,
): string {
  const resolved = path.resolve(folder);
  const existing = Object.values(grants).find(
    (grant) => grant.kind !== "temporary" && grant.path === resolved,
  );
  return existing?.id ?? `folder-${randomUUID()}`;
}
