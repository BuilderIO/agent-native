import { useActionMutation } from "@agent-native/core/client/hooks";
import type { CodeLayerNode, CodeLayerTreeNode } from "@shared/code-layer";
import { sourceContentHash } from "@shared/source-workspace";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";

import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import { renameFilenamePreservingExtension } from "@/pages/design-editor/code-layer-state";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import { TAB_ID } from "@/pages/design-editor/editor-session";
import { setCodeLayerAttributeInHtml } from "@/pages/design-editor/html-layer-positioning";
import { resolveOverviewScreenSourceType } from "@/pages/design-editor/pending-edits";
import { shouldIncludeScreenRenameContentOverride } from "@/pages/design-editor/selection-state";
import type { DesignFile } from "@/pages/design-editor/types";

export interface LayerRenameArgs {
  activeFile: DesignFile;
  applyFileContentUpdate: (
    fileId: string,
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => void;
  canEditDesign: boolean;
  codeLayerOwnerByNodeId: Map<
    string,
    {
      fileId: string;
      node: CodeLayerNode;
      tree: CodeLayerTreeNode[];
      runtimeOnly: boolean;
    }
  >;
  designSourceType: "inline" | "localhost" | "fusion";
  files: DesignFile[];
  getFreshActiveContent: () => string;
  getScreenContent: (screenId: string) => string;
  id: string | undefined;
  overviewScreens: OverviewScreen[];
  queryClient: QueryClient;
  renameScreenMutation: ReturnType<
    typeof useActionMutation<undefined, undefined, "rename-screen">
  >;
  serverFiles: DesignFile[];
  setSelectedLayerIdsState: Dispatch<SetStateAction<string[]>>;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function runLayerRename(
  {
    activeFile,
    applyFileContentUpdate,
    canEditDesign,
    codeLayerOwnerByNodeId,
    designSourceType,
    files,
    getFreshActiveContent,
    getScreenContent,
    id,
    overviewScreens,
    queryClient,
    renameScreenMutation,
    serverFiles,
    setSelectedLayerIdsState,
    t,
  }: LayerRenameArgs,
  layerId: string,
  name: string,
) {
  if (!canEditDesign) return;
  const renamedFile = files.find((file) => file.id === layerId);
  if (renamedFile) {
    const nextFilename = renameFilenamePreservingExtension(
      renamedFile.filename,
      name,
    );
    if (nextFilename === renamedFile.filename) return;
    const previousFilename = renamedFile.filename;
    const contentOverrides = serverFiles.flatMap((file) => {
      const screen = overviewScreens.find(
        (candidate) => candidate.id === file.id,
      );
      if (!screen) return [];
      const freshContent = getScreenContent(file.id);
      if (
        !shouldIncludeScreenRenameContentOverride({
          fileType: file.fileType,
          sourceType: resolveOverviewScreenSourceType(screen, designSourceType),
          persistedContent: file.content,
          freshContent,
        })
      ) {
        return [];
      }
      return [
        {
          fileId: file.id,
          content: freshContent,
          expectedVersionHash: sourceContentHash(file.content),
        },
      ];
    });

    // Rename is one atomic server mutation: it validates uniqueness and
    // updates the filename plus every exact data-screen reference (self
    // links included) in one transaction. Apply the filename optimistically
    // because it does not rebuild iframe content; the committed HTML
    // snapshots returned below are then patched into live previews/Yjs in
    // place, avoiding the old rename -> N independent save race and white
    // flashes from srcdoc reloads.
    queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
      if (!old || typeof old !== "object" || !Array.isArray(old.files)) {
        return old;
      }
      return {
        ...old,
        files: old.files.map((file: DesignFile) =>
          file.id === layerId ? { ...file, filename: nextFilename } : file,
        ),
      };
    });

    renameScreenMutation.mutate(
      {
        id: layerId,
        name,
        requestSource: TAB_ID,
        contentOverrides,
      } as any,
      {
        onSuccess: (rawResult: unknown) => {
          const result = rawResult as {
            filename?: string;
            files?: Array<{
              id: string;
              filename: string;
              content: string;
              updatedAt: string;
              contentChanged: boolean;
            }>;
          };
          const committedFiles = Array.isArray(result.files)
            ? result.files
            : [];
          committedFiles.forEach((file) => {
            if (!file.contentChanged) return;
            applyFileContentUpdate(file.id, file.content, {
              forcePreviewFullDocument: true,
              persist: false,
              recordHistory: false,
              updatedAt: file.updatedAt,
            });
          });
          queryClient.setQueryData(
            ["action", "get-design", { id }],
            (old: any) => {
              if (
                !old ||
                typeof old !== "object" ||
                !Array.isArray(old.files)
              ) {
                return old;
              }
              const committedById = new Map(
                committedFiles.map((file) => [file.id, file]),
              );
              return {
                ...old,
                files: old.files.map((file: DesignFile) => {
                  const committed = committedById.get(file.id);
                  if (!committed) return file;
                  return {
                    ...file,
                    filename: committed.filename,
                    content: committed.content,
                    updatedAt: committed.updatedAt,
                  };
                }),
              };
            },
          );
        },
        onError: (error) => {
          // Roll back only this optimistic filename. Do not restore a
          // whole cached design snapshot because the user or a peer may
          // have edited content while the mutation was in flight.
          queryClient.setQueryData(
            ["action", "get-design", { id }],
            (old: any) => {
              if (
                !old ||
                typeof old !== "object" ||
                !Array.isArray(old.files)
              ) {
                return old;
              }
              return {
                ...old,
                files: old.files.map((file: DesignFile) =>
                  file.id === layerId && file.filename === nextFilename
                    ? { ...file, filename: previousFilename }
                    : file,
                ),
              };
            },
          );
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-design", { id }],
          });
          toast.error(
            error instanceof Error ? error.message : t("common.genericError"),
          );
        },
      },
    );
    return;
  }

  const owner = codeLayerOwnerByNodeId.get(layerId);
  const node = owner?.node;
  if (!owner || !node) return;
  const sourceFile = files.find((file) => file.id === owner.fileId);
  const sourceContent =
    owner.fileId === activeFile?.id
      ? getFreshActiveContent()
      : (sourceFile?.content ?? "");
  if (!sourceContent) return;
  const nextContent = setCodeLayerAttributeInHtml(
    sourceContent,
    node,
    "data-agent-native-layer-name",
    name,
  );
  if (!nextContent || nextContent === sourceContent) return;
  applyFileContentUpdate(owner.fileId, nextContent, {
    refreshPreview: false,
  });
  setSelectedLayerIdsState([layerId]);
}
