import { useActionMutation } from "@agent-native/core/client/hooks";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { DesignMigrationResult } from "@/components/design/editor/MakeRealDialog";
import type { DesignDataOperation } from "@/pages/design-editor/data-operations";
import { applyDesignDataOperations } from "@/pages/design-editor/data-operations";

export interface ConfirmMakeRealArgs {
  designDataJsonRef: RefObject<Record<string, unknown>>;
  id: string | undefined;
  migrateMutation: ReturnType<
    typeof useActionMutation<
      undefined,
      undefined,
      "migrate-inline-design-to-app"
    >
  >;
  queryClient: QueryClient;
  setMigrationResult: Dispatch<SetStateAction<DesignMigrationResult | null>>;
  updateDesignMutation: ReturnType<
    typeof useActionMutation<undefined, undefined, "update-design">
  >;
}

export async function runConfirmMakeReal({
  designDataJsonRef,
  id,
  migrateMutation,
  queryClient,
  setMigrationResult,
  updateDesignMutation,
}: ConfirmMakeRealArgs) {
  if (!id) return;
  try {
    const result = await migrateMutation.mutateAsync({ designId: id } as any);
    const r = result as any;
    setMigrationResult({
      branchName: r?.branchName,
      url: r?.url,
      versionId: r?.versionId,
      seedFileCount: r?.seedFileCount,
      status: r?.status,
      projectId: r?.projectId,
      cta: r?.cta,
    });

    // When the Builder agent accepted the job (status = "processing"),
    // flip the design data to sourceType "fusion" so capability-gated
    // panels (branches, deploy) light up on refresh.
    if (r?.status === "processing" && r?.url) {
      const dataOperations: DesignDataOperation[] = [
        { op: "set", path: ["sourceType"], value: "fusion" },
        { op: "set", path: ["fusionUrl"], value: r.url },
        r.branchName === undefined
          ? { op: "delete", path: ["fusionBranchName"] }
          : {
              op: "set",
              path: ["fusionBranchName"],
              value: r.branchName,
            },
        r.projectId === undefined
          ? { op: "delete", path: ["fusionProjectId"] }
          : {
              op: "set",
              path: ["fusionProjectId"],
              value: r.projectId,
            },
      ];
      const nextData = applyDesignDataOperations(
        designDataJsonRef.current,
        dataOperations,
      );
      designDataJsonRef.current = nextData;
      queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
        if (!old || typeof old !== "object") return old;
        return { ...old, data: JSON.stringify(nextData) };
      });
      updateDesignMutation.mutate({ id, dataOperations } as any, {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: ["action", "get-design"],
          });
        },
        onError: () => {
          queryClient.invalidateQueries({
            queryKey: ["action", "get-design"],
          });
        },
      });
    } else if (r?.status === "not-configured") {
      // Builder not connected — leave dialog open to show the CTA.
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Migration failed";
    toast.error(message);
  }
}
