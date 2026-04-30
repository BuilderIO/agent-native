import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";

export type VideoFolder = {
  id: string;
  name: string;
  createdAt?: string;
};

type FolderRow = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  visibility: string;
  ownerEmail: string;
  orgId: string | null;
  compositionIds: string[];
};

const LIST_KEY = ["action", "list-folders", undefined] as const;

export function useFolders() {
  const queryClient = useQueryClient();

  const { data: rows = [] } = useActionQuery<FolderRow[]>("list-folders");

  const folders: VideoFolder[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
  }));

  const createMutation = useActionMutation("create-folder");
  const renameMutation = useActionMutation("rename-folder");
  const deleteMutation = useActionMutation("delete-folder");
  const moveMutation = useActionMutation("move-composition-to-folder");

  const patchFolders = useCallback(
    (fn: (prev: FolderRow[]) => FolderRow[]) => {
      queryClient.setQueryData<FolderRow[]>(LIST_KEY, (prev) => fn(prev ?? []));
    },
    [queryClient],
  );

  const createFolder = useCallback(
    (name: string): VideoFolder => {
      const id = nanoid();
      const trimmed = name.trim() || "New Folder";
      const now = new Date().toISOString();

      patchFolders((prev) => [
        {
          id,
          name: trimmed,
          createdAt: now,
          updatedAt: now,
          visibility: "private",
          ownerEmail: "",
          orgId: null,
          compositionIds: [],
        },
        ...prev,
      ]);

      createMutation.mutate(
        { name: trimmed, id },
        {
          onError: () => {
            patchFolders((prev) => prev.filter((f) => f.id !== id));
          },
        },
      );

      return { id, name: trimmed, createdAt: now };
    },
    [createMutation, patchFolders],
  );

  const renameFolder = useCallback(
    (folderId: string, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed) return;

      const previous = queryClient.getQueryData<FolderRow[]>(LIST_KEY);

      patchFolders((prev) =>
        prev.map((f) => (f.id === folderId ? { ...f, name: trimmed } : f)),
      );

      renameMutation.mutate(
        { id: folderId, name: trimmed },
        {
          onError: () => {
            if (previous) queryClient.setQueryData(LIST_KEY, previous);
          },
        },
      );
    },
    [queryClient, renameMutation, patchFolders],
  );

  const deleteFolder = useCallback(
    (folderId: string) => {
      const previous = queryClient.getQueryData<FolderRow[]>(LIST_KEY);

      patchFolders((prev) => prev.filter((f) => f.id !== folderId));

      deleteMutation.mutate(
        { id: folderId },
        {
          onError: () => {
            if (previous) queryClient.setQueryData(LIST_KEY, previous);
          },
        },
      );
    },
    [queryClient, deleteMutation, patchFolders],
  );

  const addToFolder = useCallback(
    (compositionId: string, folderId: string) => {
      const previous = queryClient.getQueryData<FolderRow[]>(LIST_KEY);

      patchFolders((prev) =>
        prev.map((f) => {
          const without = f.compositionIds.filter((id) => id !== compositionId);
          if (f.id === folderId) {
            return { ...f, compositionIds: [...without, compositionId] };
          }
          return { ...f, compositionIds: without };
        }),
      );

      moveMutation.mutate(
        { compositionId, folderId },
        {
          onError: () => {
            if (previous) queryClient.setQueryData(LIST_KEY, previous);
          },
        },
      );
    },
    [queryClient, moveMutation, patchFolders],
  );

  const removeFromFolder = useCallback(
    (compositionId: string) => {
      const previous = queryClient.getQueryData<FolderRow[]>(LIST_KEY);

      patchFolders((prev) =>
        prev.map((f) => ({
          ...f,
          compositionIds: f.compositionIds.filter((id) => id !== compositionId),
        })),
      );

      moveMutation.mutate(
        { compositionId, folderId: "" },
        {
          onError: () => {
            if (previous) queryClient.setQueryData(LIST_KEY, previous);
          },
        },
      );
    },
    [queryClient, moveMutation, patchFolders],
  );

  const getFolderForComposition = useCallback(
    (compositionId: string): string | null => {
      const folder = rows.find((f) => f.compositionIds.includes(compositionId));
      return folder?.id ?? null;
    },
    [rows],
  );

  const getCompositionsInFolder = useCallback(
    (folderId: string): string[] => {
      const folder = rows.find((f) => f.id === folderId);
      return folder?.compositionIds ?? [];
    },
    [rows],
  );

  return {
    folders,
    createFolder,
    renameFolder,
    deleteFolder,
    addToFolder,
    removeFromFolder,
    getFolderForComposition,
    getCompositionsInFolder,
  };
}
