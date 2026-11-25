import { agentNativePath } from "@agent-native/core/client/api-path";
import {
  reportWriteFailure,
  writeFailureFromResponse,
} from "@agent-native/core/client/write-failure";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface SlotInstall {
  installId: string;
  extensionId: string;
  name: string;
  description: string;
  icon: string | null;
  updatedAt: string;
  position: number;
  config: string | null;
}

export interface SlotExtension {
  extensionId: string;
  name: string;
  description: string;
  icon: string | null;
  config: string | null;
}

export function slotInstallsQueryKey(slotId: string) {
  return ["slot-installs", slotId] as const;
}

function slotPath(slotId: string, rest: string) {
  return agentNativePath(
    `/_agent-native/slots/${encodeURIComponent(slotId)}/${rest}`,
  );
}

/** The widgets the current user has added to a slot, in order. */
export function useSlotInstalls(
  slotId: string,
  options: { enabled?: boolean } = {},
) {
  return useQuery<SlotInstall[]>({
    queryKey: slotInstallsQueryKey(slotId),
    enabled: options.enabled ?? true,
    queryFn: async () => {
      const res = await fetch(slotPath(slotId, "installs"));
      if (!res.ok)
        throw new Error(`Failed to load slot installs (${res.status})`);
      return res.json();
    },
  });
}

/** Every widget the current user can add to a slot, added or not. */
export function useSlotExtensions(
  slotId: string,
  options: { enabled?: boolean } = {},
) {
  return useQuery<SlotExtension[]>({
    queryKey: ["slot-available", slotId],
    enabled: options.enabled ?? true,
    queryFn: async () => {
      const res = await fetch(slotPath(slotId, "available"));
      if (!res.ok) {
        throw new Error(`Failed to load available extensions (${res.status})`);
      }
      return res.json();
    },
  });
}

/**
 * Adds and removes widgets in a slot, updating the slot's install list right
 * away and putting it back from the server once the write settles.
 */
export function useSlotInstallActions(slotId: string) {
  const queryClient = useQueryClient();
  const queryKey = slotInstallsQueryKey(slotId);

  const settle = async (request: () => Promise<Response>) => {
    try {
      const res = await request();
      if (!res.ok) reportWriteFailure(writeFailureFromResponse(res));
    } catch (error) {
      reportWriteFailure(error);
    } finally {
      void queryClient.invalidateQueries({ queryKey });
    }
  };

  const install = (extension: SlotExtension) => {
    queryClient.setQueryData<SlotInstall[]>(queryKey, (old) => {
      if (!old) return old;
      return [
        ...old,
        {
          installId: `optimistic-${extension.extensionId}`,
          extensionId: extension.extensionId,
          name: extension.name,
          description: extension.description,
          icon: extension.icon,
          updatedAt: new Date().toISOString(),
          position: old.length,
          config: extension.config,
        },
      ];
    });
    return settle(() =>
      fetch(slotPath(slotId, "install"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extensionId: extension.extensionId }),
      }),
    );
  };

  const uninstall = (extensionId: string) => {
    queryClient.setQueryData<SlotInstall[]>(queryKey, (old) =>
      (old ?? []).filter((item) => item.extensionId !== extensionId),
    );
    return settle(() =>
      fetch(slotPath(slotId, `install/${encodeURIComponent(extensionId)}`), {
        method: "DELETE",
      }),
    );
  };

  return { install, uninstall };
}
