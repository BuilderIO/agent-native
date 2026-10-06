import type { IconValue } from "../../icons/index.js";
import { agentNativePath } from "../api-path.js";

export function workspacePrivateIconUrl(
  orgId: string,
  image: Extract<IconValue, { kind: "image" }>,
): string | undefined {
  if (image.authority === "url") return image.assetId;
  if (image.authority !== "private-icon" || !orgId) return undefined;
  return agentNativePath(
    `/_agent-native/org/private-icons/${encodeURIComponent(orgId)}/${encodeURIComponent(image.assetId)}`,
  );
}

export function workspacePrivateIconLibraryUrl(
  orgId: string,
  image: Extract<IconValue, { kind: "image" }>,
): string | undefined {
  if (image.authority === "url") return image.assetId;
  if (image.authority !== "private-icon" || !orgId) return undefined;
  return agentNativePath(
    `/_agent-native/org/private-icons/library/${encodeURIComponent(orgId)}/${encodeURIComponent(image.assetId)}`,
  );
}

export async function uploadWorkspacePrivateIcon(
  file: File,
): Promise<Extract<IconValue, { kind: "image" }>> {
  const form = new FormData();
  form.set("file", file);
  const response = await fetch(
    agentNativePath("/_agent-native/org/private-icons"),
    {
      method: "POST",
      credentials: "include",
      body: form,
    },
  );
  if (!response.ok) {
    const body: unknown = response.headers
      .get("content-type")
      ?.includes("application/json")
      ? await response.json()
      : null;
    const message =
      body &&
      typeof body === "object" &&
      "message" in body &&
      typeof body.message === "string"
        ? body.message
        : `Workspace icon upload failed (${response.status}).`;
    throw new Error(message);
  }
  const body: unknown = await response.json();
  if (
    !body ||
    typeof body !== "object" ||
    !("id" in body) ||
    typeof body.id !== "string"
  ) {
    throw new Error("Workspace icon upload returned an invalid asset ID.");
  }
  return {
    version: 1,
    kind: "image",
    authority: "private-icon",
    assetId: body.id,
    alt: file.name.replace(/\.[^./\\]+$/, ""),
  };
}
