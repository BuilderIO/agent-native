import type { ExtensionChangeTarget } from "../../extensions/change-marker.js";

export async function getExtensionShareChangeTargets(
  resourceType: string,
  resourceId: string,
): Promise<ExtensionChangeTarget[]> {
  if (resourceType !== "extension") return [];
  const { getExtensionChangeTargets } =
    await import("../../extensions/store.js");
  return getExtensionChangeTargets(resourceId);
}

export async function notifyExtensionShareChanged(
  resourceType: string,
  resourceId: string,
  beforeTargets: ExtensionChangeTarget[],
): Promise<void> {
  if (resourceType !== "extension") return;
  const { notifyExtensionChangeForResource } =
    await import("../../extensions/store.js");
  await notifyExtensionChangeForResource(resourceId, beforeTargets);
}
