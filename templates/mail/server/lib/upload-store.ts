import { getUserSetting, putUserSetting } from "@agent-native/core/settings";

const MEDIA_UPLOADS_KEY = "media-uploads";

export interface StoredUpload {
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url?: string;
  /** Legacy SQL fallback used by older uploads. New uploads store provider URLs. */
  dataBase64?: string;
  createdAt: number;
}

async function readUploads(
  ownerEmail: string,
): Promise<Record<string, StoredUpload>> {
  const data = await getUserSetting(ownerEmail, MEDIA_UPLOADS_KEY);
  if (data && typeof data === "object" && (data as any).uploads) {
    return (data as any).uploads as Record<string, StoredUpload>;
  }
  return {};
}

export async function getStoredUpload(
  ownerEmail: string,
  filename: string,
): Promise<StoredUpload | null> {
  const uploads = await readUploads(ownerEmail);
  return uploads[filename] ?? null;
}

export async function putStoredUpload(
  ownerEmail: string,
  upload: StoredUpload,
): Promise<void> {
  const uploads = await readUploads(ownerEmail);
  uploads[upload.filename] = upload;
  await putUserSetting(ownerEmail, MEDIA_UPLOADS_KEY, { uploads });
}
