import { useActionMutation } from "@agent-native/core/client/hooks";
import { toast } from "sonner";

import type { DesignFile } from "@/pages/design-editor/types";

export interface DetachInstanceMenuActionArgs {
  activeContent: string;
  activeFile: DesignFile;
  activeFileId: string | null;
  detachComponentInstanceMutation: ReturnType<
    typeof useActionMutation<undefined, undefined, "detach-component-instance">
  >;
  handleComponentPropApplied: (
    fileId: string,
    nextContent: string,
    updatedAt?: string,
  ) => void;
  id: string | undefined;
  selectedComponentNodeId: string | undefined;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function runDetachInstanceMenuAction({
  activeContent,
  activeFile,
  activeFileId,
  detachComponentInstanceMutation,
  handleComponentPropApplied,
  id,
  selectedComponentNodeId,
  t,
}: DetachInstanceMenuActionArgs) {
  if (!id || !selectedComponentNodeId) return;
  detachComponentInstanceMutation.mutate(
    {
      designId: id,
      nodeId: selectedComponentNodeId,
      fileId: activeFileId ?? undefined,
      ...(activeContent
        ? {
            source: {
              currentContent: activeContent,
              ...(activeFile?.updatedAt
                ? { revision: activeFile.updatedAt }
                : {}),
            },
          }
        : {}),
    },
    {
      onSuccess: (result: {
        detached?: boolean;
        conflict?: boolean;
        ctaRequired?: boolean;
        error?: string;
        ctaMessage?: string;
        note?: string;
        fileId?: string;
        content?: string;
        updatedAt?: string;
      }) => {
        if (result.conflict || result.ctaRequired) {
          toast.error(
            result.error ??
              result.ctaMessage ??
              t("designEditor.componentInstances.detachFailed"),
          );
          return;
        }
        if (result.detached) {
          toast(result.note ?? t("designEditor.componentInstances.detached"));
          if (
            typeof result.fileId === "string" &&
            typeof result.content === "string"
          ) {
            handleComponentPropApplied(
              result.fileId,
              result.content,
              result.updatedAt,
            );
          }
        }
      },
      onError: () =>
        toast.error(t("designEditor.componentInstances.detachFailed")),
    },
  );
}
