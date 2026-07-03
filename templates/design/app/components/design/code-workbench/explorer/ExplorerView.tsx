import { useActionQuery } from "@agent-native/core/client";
import { useCallback, useEffect, useMemo, useState } from "react";

import { prettyScreenName } from "@/lib/screen-names";

import { useWorkbench } from "../store";
import { buildFileTree } from "../workspace/tree";
import { baseName, type WorkspaceFileEntry } from "../workspace/types";
import { FileTree } from "./FileTree";

export interface ExplorerViewProps {
  designId: string;
  explorerFocusToken: number;
  onRequestLocalWriteConsent?: (
    connectionId: string,
    retry: () => void,
  ) => void;
}

/**
 * Multi-root explorer: one collapsible section per workspace provider.
 * "Design files" (inline) is fetched via `list-source-files` so useDbSync
 * keeps it live; localhost providers poll via provider.listFiles() with a
 * manual + files-changed-driven refresh.
 */
export function ExplorerView({
  designId,
  explorerFocusToken,
  onRequestLocalWriteConsent,
}: ExplorerViewProps) {
  const { state, api, providers } = useWorkbench();

  const inlineProviderKey = `inline:${designId}`;
  const sourceFilesQuery = useActionQuery("list-source-files", { designId });
  const inlineFiles = useMemo<WorkspaceFileEntry[]>(() => {
    const files = (
      sourceFilesQuery.data as
        | { files?: Array<Record<string, unknown>> }
        | undefined
    )?.files;
    if (!files) return [];
    return files.map((file) => ({
      path: String(file.path ?? ""),
      displayName:
        typeof file.path === "string"
          ? prettyScreenName(baseName(file.path))
          : typeof file.displayName === "string"
            ? file.displayName
            : undefined,
      fileId: typeof file.fileId === "string" ? file.fileId : undefined,
      readonly: Boolean(file.readonly),
    }));
  }, [sourceFilesQuery.data]);

  const localhostProviders = providers.filter(
    (provider) => provider.kind === "localhost",
  );
  const [localhostFiles, setLocalhostFiles] = useState<
    Record<string, WorkspaceFileEntry[]>
  >({});

  const loadLocalhostFiles = useCallback(
    async (providerKey: string) => {
      const provider = providers.find((entry) => entry.key === providerKey);
      if (!provider) return;
      try {
        const files = await provider.listFiles();
        setLocalhostFiles((current) => ({ ...current, [providerKey]: files }));
      } catch {
        // Best-effort: leave the previous listing (or empty) on failure.
      }
    },
    [providers],
  );

  useEffect(() => {
    for (const provider of localhostProviders) {
      void loadLocalhostFiles(provider.key);
    }
    // Re-run when the set of localhost providers changes (connections added).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    localhostProviders.map((provider) => provider.key).join(","),
    loadLocalhostFiles,
  ]);

  useEffect(() => {
    return api.onFilesChanged(() => {
      sourceFilesQuery.refetch();
      for (const provider of localhostProviders) {
        void loadLocalhostFiles(provider.key);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    api,
    loadLocalhostFiles,
    localhostProviders.map((provider) => provider.key).join(","),
  ]);

  const activeUri = state.activeUri;
  const dirtyUris = useMemo(() => {
    const set = new Set<string>();
    for (const [uri, buffer] of Object.entries(state.buffers)) {
      if (buffer.dirty) set.add(uri);
    }
    return set;
  }, [state.buffers]);

  const inlineProvider = providers.find(
    (provider) => provider.key === inlineProviderKey,
  );
  // Focus goes to the first rendered tree (inline root when present, else the
  // first localhost root) — matches VS Code's single explorer focus target.
  const focusOwnerKey = inlineProvider
    ? inlineProviderKey
    : localhostProviders[0]?.key;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden pb-2">
      {inlineProvider ? (
        <FileTree
          providerKey={inlineProviderKey}
          providerLabel={"DESIGN FILES" /* i18n-ignore */}
          capabilities={inlineProvider.capabilities}
          nodes={buildFileTree(inlineFiles)}
          activeUri={activeUri}
          dirtyUris={dirtyUris}
          focusToken={
            focusOwnerKey === inlineProviderKey ? explorerFocusToken : 0
          }
          registerRef={() => {}}
          onRefresh={() => sourceFilesQuery.refetch()}
          onRequestLocalWriteConsent={onRequestLocalWriteConsent}
        />
      ) : null}
      {localhostProviders.map((provider) => (
        <FileTree
          key={provider.key}
          providerKey={provider.key}
          providerLabel={`LOCAL FILES — ${provider.label}` /* i18n-ignore */}
          capabilities={provider.capabilities}
          nodes={buildFileTree(localhostFiles[provider.key] ?? [])}
          activeUri={activeUri}
          dirtyUris={dirtyUris}
          focusToken={focusOwnerKey === provider.key ? explorerFocusToken : 0}
          registerRef={() => {}}
          onRefresh={() => void loadLocalhostFiles(provider.key)}
          onRequestLocalWriteConsent={onRequestLocalWriteConsent}
        />
      ))}
      {!inlineFiles.length &&
      localhostProviders.length === 0 &&
      !sourceFilesQuery.isLoading ? (
        <p className="px-3 py-4 text-[12px] text-[var(--workbench-muted-fg)]">
          {"No files yet" /* i18n-ignore */}
        </p>
      ) : null}
    </div>
  );
}
