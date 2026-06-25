import type { QueryClient } from "@tanstack/react-query";

import { agentNativePath } from "../api-path.js";

export interface ExtensionDeleteTarget {
  id: string;
  canDelete?: boolean | null;
}

export type ExtensionDeleteResult = { mode: "deleted" | "hidden" };

async function readErrorMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return fallback;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error) return String(parsed.error);
      if (parsed?.message) return String(parsed.message);
    } catch {
      return text.slice(0, 200);
    }
  } catch {
    // Ignore body read failures and use the fallback below.
  }
  return fallback;
}

export async function hideExtensionForCurrentUser(
  extensionId: string,
): Promise<ExtensionDeleteResult> {
  const res = await fetch(
    agentNativePath(`/_agent-native/extensions/${extensionId}/hide`),
    { method: "POST" },
  );
  if (!res.ok) {
    throw new Error(
      await readErrorMessage(res, "Could not remove extension from your list"),
    );
  }
  return { mode: "hidden" };
}

export async function deleteOrHideExtension(
  extension: ExtensionDeleteTarget,
): Promise<ExtensionDeleteResult> {
  if (extension.canDelete === false) {
    return hideExtensionForCurrentUser(extension.id);
  }

  const res = await fetch(
    agentNativePath(`/_agent-native/extensions/${extension.id}`),
    { method: "DELETE" },
  );
  if (res.ok) return { mode: "deleted" };

  if (res.status === 403) {
    return hideExtensionForCurrentUser(extension.id);
  }

  throw new Error(await readErrorMessage(res, "Delete failed"));
}

export function invalidateExtensionRemoval(
  queryClient: QueryClient,
  extensionId: string,
): void {
  queryClient.removeQueries({ queryKey: ["extension", extensionId] });
  queryClient.invalidateQueries({ queryKey: ["extensions"] });
  queryClient.invalidateQueries({ queryKey: ["extension-slots", extensionId] });
  queryClient.invalidateQueries({ queryKey: ["slot-installs"] });
  queryClient.invalidateQueries({ queryKey: ["slot-available"] });
}
