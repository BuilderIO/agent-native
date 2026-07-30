import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

interface LocalhostFileListState {
  files: WorkspaceFileEntry[];
  loading: boolean;
  error?: string;
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
  const t = useT();
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
  const localhostProviderKeys = localhostProviders
    .map((provider) => provider.key)
    .join(",");
  const providersRef = useRef(providers);
  providersRef.current = providers;
  const translateRef = useRef(t);
  translateRef.current = t;
  const refetchSourceFilesRef = useRef(sourceFilesQuery.refetch);
  refetchSourceFilesRef.current = sourceFilesQuery.refetch;
  const [localhostFileLists, setLocalhostFileLists] = useState<
    Record<string, LocalhostFileListState>
  >({});
  const requestIdsRef = useRef<Record<string, number>>({});
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdsRef.current = {};
    };
  }, []);

  const loadLocalhostFiles = useCallback(async (providerKey: string) => {
    const provider = providersRef.current.find(
      (entry) => entry.key === providerKey,
    );
    if (!provider || !mountedRef.current) return;
    const requestId = (requestIdsRef.current[providerKey] ?? 0) + 1;
    requestIdsRef.current[providerKey] = requestId;
    setLocalhostFileLists((current) => ({
      ...current,
      [providerKey]: {
        files: current[providerKey]?.files ?? [],
        loading: true,
      },
    }));
    try {
      const files = await provider.listFiles();
      if (
        !mountedRef.current ||
        requestIdsRef.current[providerKey] !== requestId
      ) {
        return;
      }
      setLocalhostFileLists((current) => ({
        ...current,
        [providerKey]: { files, loading: false },
      }));
    } catch (error) {
      if (
        !mountedRef.current ||
        requestIdsRef.current[providerKey] !== requestId
      ) {
        return;
      }
      setLocalhostFileLists((current) => ({
        ...current,
        [providerKey]: {
          files: current[providerKey]?.files ?? [],
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : translateRef.current("common.genericError"),
        },
      }));
    }
  }, []);

  useEffect(() => {
    for (const providerKey of localhostProviderKeys
      .split(",")
      .filter(Boolean)) {
      void loadLocalhostFiles(providerKey);
    }
    // Re-run when the set of localhost providers changes (connections added).
  }, [localhostProviderKeys, loadLocalhostFiles]);

  useEffect(() => {
    return api.onFilesChanged(() => {
      refetchSourceFilesRef.current();
      for (const providerKey of localhostProviderKeys
        .split(",")
        .filter(Boolean)) {
        void loadLocalhostFiles(providerKey);
      }
    });
  }, [api, loadLocalhostFiles, localhostProviderKeys]);

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
          loading={sourceFilesQuery.isLoading}
          error={
            sourceFilesQuery.error instanceof Error
              ? sourceFilesQuery.error.message
              : sourceFilesQuery.error
                ? "Could not load design files" /* i18n-ignore */
                : undefined
          }
          focusToken={
            focusOwnerKey === inlineProviderKey ? explorerFocusToken : 0
          }
          registerRef={() => {}}
          onRefresh={() => sourceFilesQuery.refetch()}
          onRequestLocalWriteConsent={onRequestLocalWriteConsent}
        />
      ) : null}
      {localhostProviders.map((provider) => {
        const fileList = localhostFileLists[provider.key];
        return (
          <FileTree
            key={provider.key}
            providerKey={provider.key}
            providerLabel={`LOCAL FILES — ${provider.label}` /* i18n-ignore */}
            providerTitle={provider.rootPath}
            capabilities={provider.capabilities}
            nodes={buildFileTree(fileList?.files ?? [])}
            activeUri={activeUri}
            dirtyUris={dirtyUris}
            loading={fileList?.loading ?? true}
            error={fileList?.error}
            focusToken={focusOwnerKey === provider.key ? explorerFocusToken : 0}
            registerRef={() => {}}
            onRefresh={() => void loadLocalhostFiles(provider.key)}
            onRequestLocalWriteConsent={onRequestLocalWriteConsent}
          />
        );
      })}
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
