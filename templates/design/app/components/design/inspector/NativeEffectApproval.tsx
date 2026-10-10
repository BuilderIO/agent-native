import {
  actionErrorMessage,
  callAction,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { NATIVE_EFFECT_DEFINITION_CATALOG } from "@shared/native-effect-presets";
import {
  hashEffectDefinition,
  nativeEffectExecutionPayload,
} from "@shared/native-effect-trust";
import type { EffectDefinition } from "@shared/native-effects";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

type Approval =
  | { status: "pending" }
  | { status: "unreadable" }
  | { status: "builtin"; hash: string }
  | { status: "approved"; hash: string }
  | { status: "review"; hash: string; versionHash: string; source: string };

function sourceForReview(definition: EffectDefinition): string {
  return JSON.stringify(nativeEffectExecutionPayload(definition), null, 2);
}

export async function bundledNativeEffectApproval(
  definition: EffectDefinition,
): Promise<Approval | null> {
  const bundled = NATIVE_EFFECT_DEFINITION_CATALOG.find(
    (candidate) =>
      candidate.id === definition.id &&
      candidate.version === definition.version,
  );
  if (!bundled) return null;
  const hash = await hashEffectDefinition(definition);
  return (await hashEffectDefinition(bundled)) === hash
    ? { status: "builtin", hash }
    : null;
}

export async function readNativeEffectApprovalReview(
  result: unknown,
  designId: string,
  fileId: string,
  definitionId: string,
  definitionVersion: number,
): Promise<Approval> {
  if (!result || typeof result !== "object" || Array.isArray(result))
    return { status: "unreadable" };
  const read = result as Record<string, unknown>;
  const selected = read.selectedDefinition as EffectDefinition | null;
  if (
    read.designId !== designId ||
    read.fileId !== fileId ||
    typeof read.versionHash !== "string" ||
    !selected ||
    selected.id !== definitionId ||
    selected.version !== definitionVersion ||
    !Array.isArray(selected.passes) ||
    !selected.passes.every((pass) => typeof pass.wgsl === "string") ||
    !Array.isArray(read.approvedDefinitionHashes) ||
    !read.approvedDefinitionHashes.every(
      (hash) => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash),
    )
  )
    return { status: "unreadable" };
  const hash = await hashEffectDefinition(selected);
  const bundled = await bundledNativeEffectApproval(selected);
  if (bundled) return bundled;
  if ((read.approvedDefinitionHashes as string[]).includes(hash))
    return { status: "approved", hash };
  return {
    status: "review",
    hash,
    versionHash: read.versionHash,
    source: sourceForReview(selected),
  };
}

export function NativeEffectApproval({
  designId,
  fileId,
  definition,
}: {
  designId: string;
  fileId: string;
  definition: EffectDefinition;
}) {
  const t = useT();
  const [approval, setApproval] = useState<Approval>({ status: "pending" });
  const [saving, setSaving] = useState(false);
  const definitionId = definition.id;
  const definitionVersion = definition.version;

  useEffect(() => {
    const controller = new AbortController();
    setApproval({ status: "pending" });
    void (async () => {
      const bundled = await bundledNativeEffectApproval(definition);
      if (controller.signal.aborted) return;
      if (bundled) {
        setApproval(bundled);
        return;
      }
      const result = await callAction(
        "get-shader",
        {
          format: "native-v2",
          source: { kind: "design-file", designId, fileId },
          definitionId,
          definitionVersion,
          includeSource: true,
        },
        { method: "GET", signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      const next = await readNativeEffectApprovalReview(
        result,
        designId,
        fileId,
        definitionId,
        definitionVersion,
      );
      if (controller.signal.aborted) return;
      setApproval(next);
    })().catch(() => {
      if (!controller.signal.aborted) setApproval({ status: "unreadable" });
    });
    return () => controller.abort();
  }, [designId, fileId, definition, definitionId, definitionVersion]);

  if (approval.status === "builtin") return null;
  if (approval.status === "approved") {
    return (
      <p className="text-xs text-muted-foreground">
        {t("editPanel.shaders.nativeSourceApproved")}
      </p>
    );
  }
  if (approval.status === "pending" || approval.status === "unreadable") {
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {t(
          approval.status === "pending"
            ? "editPanel.shaders.nativeSourceChecking"
            : "editPanel.shaders.nativeSourceUnreadable",
        )}
      </p>
    );
  }
  const review = approval;
  return (
    <details className="min-w-0 text-xs">
      <summary className="cursor-pointer text-foreground">
        {t("editPanel.shaders.nativeSourceReview")}
      </summary>
      <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-[10px]">
        {review.source}
      </pre>
      <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
        SHA-256 {review.hash}
      </p>
      <Button
        type="button"
        size="sm"
        disabled={saving}
        className="mt-2"
        onClick={() => {
          setSaving(true);
          void callAction(
            "edit-native-shader",
            {
              designId,
              fileId,
              expectedVersionHash: review.versionHash,
              operation: {
                kind: "approve-definition",
                definitionId,
                definitionVersion,
                expectedExecutionHash: review.hash,
              },
            },
            { method: "POST" },
          )
            .then(() => {
              setApproval({ status: "approved", hash: review.hash });
              window.dispatchEvent(
                new Event("design-native-approvals-changed"),
              );
            })
            .catch((error) => {
              toast.error(
                actionErrorMessage(error) ??
                  t("editPanel.shaders.nativeSourceUnreadable"),
              );
              setApproval({ status: "unreadable" });
            })
            .finally(() => setSaving(false));
        }}
      >
        {t("editPanel.shaders.nativeSourceApprove")}
      </Button>
    </details>
  );
}
