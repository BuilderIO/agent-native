import { agentNativePath } from "@agent-native/core/client/api-path";

export async function uploadFileClient(
  blob: Blob,
  filename: string,
): Promise<{ url: string } | null> {
  const form = new FormData();
  form.append("file", blob, filename);
  const response = await fetch(agentNativePath("/_agent-native/file-upload"), {
    method: "POST",
    body: form,
  });
  if (!response.ok) return null;
  const json = await response.json();
  return json?.url ? { url: json.url as string } : null;
}
