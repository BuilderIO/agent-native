import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useState } from "react";

import { formatSubmittedAt } from "@/components/forms/submission-format";
import { FormRunner } from "@/components/respond/FormRunner";
import { ThemedSurface } from "@/components/respond/ThemedSurface";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

function VersionPreview({
  version,
}: {
  version: ReturnType<typeof useVersion>;
}) {
  const t = useT();
  if (version.isPending)
    return (
      <div
        role="status"
        aria-label={t("forms.common.loading")}
        className="flex flex-col gap-4 p-8"
      >
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-9 w-64" />
      </div>
    );
  if (version.isError)
    return (
      <p role="alert" className="p-8 text-sm text-destructive">
        {t("forms.organize.versionLoadFailed")}
      </p>
    );
  return (
    <ThemedSurface
      settings={version.data.settings}
      withCss
      className="min-h-full"
    >
      <div className="px-8 py-6">
        <FormRunner
          mode="preview"
          blocks={version.data.blocks}
          settings={version.data.settings}
        />
      </div>
    </ThemedSurface>
  );
}

function useVersion(formId: string, versionId: string | undefined) {
  return useActionQuery(
    "get-form-version",
    { formId, versionId: versionId ?? "" },
    { enabled: versionId !== undefined },
  );
}

export function VersionHistoryDialog({
  formId,
  onClose,
  onRestore,
}: {
  formId: string;
  onClose: () => void;
  onRestore: (versionId: string) => void;
}) {
  const t = useT();
  const versions = useActionQuery("list-form-versions", { formId });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const list = versions.data?.versions ?? [];
  const selected = list.find((item) => item.id === selectedId) ?? list[0];
  const isCurrent = selected !== undefined && selected.id === list[0]?.id;
  const version = useVersion(formId, selected?.id);

  function restore() {
    if (!selected || isCurrent) return;
    onRestore(selected.id);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="flex h-[min(640px,85vh)] flex-col gap-0 p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{t("forms.organize.versionHistory")}</DialogTitle>
          <DialogDescription>
            {t("forms.organize.versionHistoryDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1">
          <div className="flex w-72 shrink-0 flex-col border-r border-border">
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {versions.isPending ? (
                <div
                  role="status"
                  aria-label={t("forms.common.loading")}
                  className="flex flex-col gap-2"
                >
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                </div>
              ) : versions.isError ? (
                <div className="flex flex-col items-start gap-2 p-2 text-sm text-muted-foreground">
                  {t("forms.organize.versionsLoadFailed")}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void versions.refetch()}
                  >
                    {t("forms.common.retry")}
                  </Button>
                </div>
              ) : (
                <ul className="flex flex-col gap-1">
                  {list.map((item, index) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        aria-current={item.id === selected?.id}
                        onClick={() => setSelectedId(item.id)}
                        className={cn(
                          "flex w-full flex-col rounded-[7px] px-3 py-2 text-left hover:bg-accent",
                          item.id === selected?.id && "bg-accent",
                        )}
                      >
                        <span className="text-sm font-medium">
                          {index === 0
                            ? t("forms.organize.currentVersion")
                            : formatSubmittedAt(item.createdAt)}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {index === 0
                            ? `${formatSubmittedAt(item.updatedAt)} · `
                            : ""}
                          {t(
                            item.kind === "publish"
                              ? "forms.organize.versionPublished"
                              : "forms.organize.versionEdited",
                          )}{" "}
                          · {item.author}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex items-center gap-3 border-t border-border p-3">
              <Button
                size="sm"
                disabled={!selected || isCurrent}
                onClick={restore}
              >
                {t("forms.organize.restore")}
              </Button>
            </div>
          </div>
          <div className="min-w-0 flex-1 overflow-y-auto">
            {selected ? <VersionPreview version={version} /> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
