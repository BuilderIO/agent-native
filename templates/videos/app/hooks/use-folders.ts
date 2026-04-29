import { useState, useCallback, useEffect } from "react";

const FOLDERS_KEY = "videos-library-folders";
const MEMBERSHIPS_KEY = "videos-library-memberships";

export type VideoFolder = {
  id: string;
  name: string;
  createdAt: number;
};

type FolderMembership = {
  compositionId: string;
  folderId: string;
};

function loadFolders(): VideoFolder[] {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function loadMemberships(): FolderMembership[] {
  try {
    const raw = localStorage.getItem(MEMBERSHIPS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function useFolders() {
  const [folders, setFolders] = useState<VideoFolder[]>(loadFolders);
  const [memberships, setMemberships] =
    useState<FolderMembership[]>(loadMemberships);

  useEffect(() => {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
  }, [folders]);

  useEffect(() => {
    localStorage.setItem(MEMBERSHIPS_KEY, JSON.stringify(memberships));
  }, [memberships]);

  const createFolder = useCallback((name: string): VideoFolder => {
    const folder: VideoFolder = {
      id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim() || "New Folder",
      createdAt: Date.now(),
    };
    setFolders((prev) => [...prev, folder]);
    return folder;
  }, []);

  const renameFolder = useCallback((folderId: string, newName: string) => {
    setFolders((prev) =>
      prev.map((f) =>
        f.id === folderId ? { ...f, name: newName.trim() || f.name } : f,
      ),
    );
  }, []);

  const deleteFolder = useCallback((folderId: string) => {
    setFolders((prev) => prev.filter((f) => f.id !== folderId));
    setMemberships((prev) => prev.filter((m) => m.folderId !== folderId));
  }, []);

  const addToFolder = useCallback(
    (compositionId: string, folderId: string) => {
      setMemberships((prev) => {
        const filtered = prev.filter((m) => m.compositionId !== compositionId);
        return [...filtered, { compositionId, folderId }];
      });
    },
    [],
  );

  const removeFromFolder = useCallback((compositionId: string) => {
    setMemberships((prev) =>
      prev.filter((m) => m.compositionId !== compositionId),
    );
  }, []);

  const getFolderForComposition = useCallback(
    (compositionId: string): string | null =>
      memberships.find((m) => m.compositionId === compositionId)?.folderId ??
      null,
    [memberships],
  );

  const getCompositionsInFolder = useCallback(
    (folderId: string): string[] =>
      memberships
        .filter((m) => m.folderId === folderId)
        .map((m) => m.compositionId),
    [memberships],
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
