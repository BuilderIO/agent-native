import {
  callAction,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { resolveCodeLayerTarget } from "@shared/code-layer";
import {
  listShaderMounts,
  listShadersInHtml,
  removeShaderFill,
  removeShaderFromNode,
} from "@shared/shader-fills";
import { IconMinus, IconWaveSine } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Skeleton } from "@/components/ui/skeleton";

import { SectionIconButton } from "../edit-panel/inspector-controls";
import {
  InspectorGridCell,
  InspectorPaintRow,
} from "../edit-panel/inspector-grid";
import type { ShaderEditorContext } from "../shader-source-coordination";
import {
  broadcastShaderMessage,
  withShaderWriteLock,
} from "../shader-source-coordination";

type SourceFileResult = {
  content?: string;
  versionHash?: string;
  fileId?: string;
  updatedAt?: string;
};

export function findSavedGlslFill(context: ShaderEditorContext | undefined): {
  id: string;
  name: string;
} | null {
  const { content, nodeId, selector } = context ?? {};
  if (!content || !nodeId || !content.includes("data-an-shader-fill"))
    return null;
  const resolved = selector
    ? resolveCodeLayerTarget(content, { selector }).resolution
    : null;
  const authoredId =
    resolved?.status === "resolved" && resolved.node
      ? resolved.node.dataAttributes["data-agent-native-node-id"]
      : undefined;
  const mount = listShaderMounts(content).find(
    (item) =>
      (item.nodeId === nodeId || item.nodeId === authoredId) &&
      item.mode === "fill",
  );
  if (!mount) return null;
  const definition = listShadersInHtml(content).find(
    (item) => item.id === mount.shaderId,
  );
  return { id: mount.shaderId, name: definition?.name ?? mount.shaderId };
}

function useSavedGlslSource(context: ShaderEditorContext) {
  const enabled =
    Boolean(context.designId && context.fileId) &&
    context.content === undefined &&
    context.editSource === undefined;
  const query = useActionQuery<SourceFileResult>(
    "read-source-file",
    { designId: context.designId ?? "", fileId: context.fileId ?? "" },
    { enabled },
  );
  const content =
    context.content ?? (enabled ? query.data?.content : undefined);
  const status: "ready" | "pending" | "unreadable" =
    content !== undefined
      ? "ready"
      : query.isLoading
        ? "pending"
        : "unreadable";
  const mounts = useMemo(
    () => (status === "ready" ? listShaderMounts(content!) : []),
    [content, status],
  );
  const definitions = useMemo(
    () => (status === "ready" ? listShadersInHtml(content!) : []),
    [content, status],
  );
  return { ...query, status, content, mounts, definitions };
}

export function useSavedGlslFill(context: ShaderEditorContext | undefined) {
  const source = useSavedGlslSource(context ?? {});
  return {
    status: source.status,
    fill:
      source.status === "ready"
        ? findSavedGlslFill({ ...context, content: source.content })
        : null,
  };
}

export function useRemoveSavedGlslShader(context: ShaderEditorContext) {
  const t = useT();
  const applyEdit = useActionMutation("apply-source-edit");
  const [busy, setBusy] = useState(false);
  const remove = async (mode: "fill" | "effect"): Promise<boolean> => {
    if (!context.nodeId || !context.fileId) return false;
    const nodeId = context.nodeId;
    const transform = (html: string) =>
      mode === "fill"
        ? removeShaderFill(html, nodeId)
        : removeShaderFromNode(html, nodeId, "effect");
    setBusy(true);
    try {
      if (context.editSource) {
        const result = context.editSource(transform);
        if (result.status === "failed") throw new Error(result.error);
        if (result.status === "applied")
          broadcastShaderMessage({ type: "glsl-shader-rescan" });
        return true;
      }
      if (!context.designId) throw new Error("shader-source-file-required");
      const { designId, fileId } = context;
      return await withShaderWriteLock(fileId, async () => {
        const source = await callAction<SourceFileResult>(
          "read-source-file",
          { designId, fileId },
          { method: "GET" },
        );
        if (typeof source.content !== "string" || !source.versionHash)
          throw new Error("shader-source-unavailable");
        const changed = transform(source.content);
        if (changed.errors.length) throw new Error(changed.errors[0]);
        if (changed.html === source.content) return true;
        const written = (await applyEdit.mutateAsync({
          designId,
          fileId,
          edit: { kind: "full-replace", content: changed.html },
          expectedVersionHash: source.versionHash,
        })) as SourceFileResult;
        context.onApplied?.(
          fileId,
          changed.html,
          written.updatedAt,
          source.content,
        );
        broadcastShaderMessage({ type: "glsl-shader-rescan" });
        return true;
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("editPanel.shaders.saveFailed"),
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { remove, busy };
}

export function SavedGlslEffectRow({
  context,
}: {
  context: ShaderEditorContext;
}) {
  const t = useT();
  const source = useSavedGlslSource(context);
  const { remove, busy } = useRemoveSavedGlslShader(context);
  const mount = source.mounts.find(
    (item) => item.nodeId === context.nodeId && item.mode === "effect",
  );
  if (!mount && source.status === "ready") return null;
  if (!mount) {
    return (
      <InspectorPaintRow>
        <InspectorGridCell span={28}>
          {source.status === "pending" ? (
            <Skeleton className="h-6 w-full" />
          ) : (
            <div role="alert" className="text-muted-foreground !text-[11px]">
              {t("common.genericError")}
            </div>
          )}
        </InspectorGridCell>
      </InspectorPaintRow>
    );
  }
  const definition = source.definitions.find(
    (item) => item.id === mount.shaderId,
  );
  return (
    <InspectorPaintRow>
      <InspectorGridCell span={20}>
        <div className="flex h-6 min-w-0 items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px]">
          <IconWaveSine className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
            {definition?.name ?? mount.shaderId}
          </span>
        </div>
      </InspectorGridCell>
      <InspectorGridCell span={4} className="flex justify-center" />
      <InspectorGridCell span={4} className="flex justify-center">
        <SectionIconButton
          label={t("editPanel.shaders.removeShaderEffect")}
          disabled={busy}
          onClick={() =>
            void remove("effect").then((removed) => {
              if (removed) void source.refetch();
            })
          }
        >
          <IconMinus className="size-3.5" />
        </SectionIconButton>
      </InspectorGridCell>
    </InspectorPaintRow>
  );
}

export function useHasSavedGlslEffect(
  context: ShaderEditorContext | undefined,
): boolean {
  const source = useSavedGlslSource(context ?? {});
  return Boolean(
    context?.nodeId &&
    (source.content === undefined ||
      source.mounts.some(
        (item) => item.nodeId === context.nodeId && item.mode === "effect",
      )),
  );
}
