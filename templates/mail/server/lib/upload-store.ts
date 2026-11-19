import { getUserSetting, mutateUserSetting } from "@agent-native/core/settings";

const MEDIA_UPLOADS_KEY = "media-uploads";

export interface StoredUpload {
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url?: string;
  dataBase64?: string;
  createdAt: number;
}

function uploadsIn(data: unknown): Record<string, StoredUpload> {
  if (data && typeof data === "object" && (data as any).uploads) {
    return (data as any).uploads as Record<string, StoredUpload>;
  }
  return {};
}

export async function getStoredUpload(
  ownerEmail: string,
  filename: string,
): Promise<StoredUpload | null> {
  const uploads = uploadsIn(
    await getUserSetting(ownerEmail, MEDIA_UPLOADS_KEY),
  );
  // A name like `constructor` must not find the object's own properties.
  return Object.prototype.hasOwnProperty.call(uploads, filename)
    ? (uploads[filename] ?? null)
    : null;
}

export async function putStoredUpload(
  ownerEmail: string,
  upload: StoredUpload,
): Promise<void> {
  // One owner's uploads can finish together. A plain read then write would let
  // the later write drop the earlier record, and a draft can't attach a file
  // whose record is gone.
  await mutateUserSetting(ownerEmail, MEDIA_UPLOADS_KEY, (current) => ({
    uploads: { ...uploadsIn(current), [upload.filename]: upload },
  }));
}
