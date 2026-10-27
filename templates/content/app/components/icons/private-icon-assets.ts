import { agentNativePath } from "@agent-native/core/client/api-path";
import type { IconValue } from "@agent-native/core/icons";

type ImageIcon = Extract<IconValue, { kind: "image" }>;

const PRIVATE_ICON_ID = /^[A-Za-z0-9_-]{1,128}$/u;

export function contentImageIconUrl(image: ImageIcon): string | undefined {
  if (image.authority === "private-icon") {
    return PRIVATE_ICON_ID.test(image.assetId)
      ? agentNativePath(`/api/private-icons/${image.assetId}`)
      : undefined;
  }
  if (
    (image.authority === "url" || image.authority === "notion") &&
    /^https?:\/\//u.test(image.assetId)
  ) {
    return image.assetId;
  }
  return undefined;
}

export async function uploadPrivateIconFile(
  file: File,
  documentId: string,
): Promise<string> {
  if (!documentId.trim()) throw new Error("An icon target is required");
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("documentId", documentId);
  const response = await fetch(agentNativePath("/api/private-icons"), {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throw new Error(`Private icon upload failed (${response.status})`);
  }
  const payload: unknown = await response.json();
  if (
    !payload ||
    typeof payload !== "object" ||
    !("id" in payload) ||
    typeof payload.id !== "string" ||
    !PRIVATE_ICON_ID.test(payload.id)
  ) {
    throw new Error("Private icon upload returned an invalid asset ID");
  }
  return payload.id;
}
