import { appBasePath } from "@agent-native/core/client/api-path";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconLoader2,
  IconPencil,
  IconRefresh,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { UploadStorageGate } from "@/components/editor/UploadStorageGate";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useSlideFileStorageStatus } from "@/hooks/use-slide-file-storage-status";
import {
  assetErrorTranslationKey,
  isAssetStorageSetupError,
} from "@/lib/asset-error-copy";

interface Asset {
  id: string;
  url: string;
  filename: string;
  size: number;
  createdAt: string;
}

interface AssetLibraryPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectAsset?: (url: string) => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

export default function AssetLibraryPanel({
  open,
  onOpenChange,
  onSelectAsset,
  anchorRef,
}: AssetLibraryPanelProps) {
  const t = useT();
  const storageQuery = useSlideFileStorageStatus(open);
  const fileStorageConfigured =
    storageQuery.data?.configured === true && !storageQuery.isError;
  const [uploading, setUploading] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Asset | null>(null);
  const [renameFilename, setRenameFilename] = useState("");
  const [replaceTarget, setReplaceTarget] = useState<Asset | null>(null);
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [storagePromptOpen, setStoragePromptOpen] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const assetsQuery = useActionQuery<Asset[]>("list-assets", undefined, {
    enabled: open,
  });
  const deleteAsset = useActionMutation<{ success: boolean }, { id: string }>(
    "delete-asset",
  );
  const updateAsset = useActionMutation<
    { success: boolean; filename: string; cleanupWarning?: boolean },
    { id: string; filename?: string; replacementId?: string }
  >("update-asset");
  const assets = assetsQuery.data ?? [];

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !renameTarget && !storagePromptOpen) {
        onOpenChange(false);
      }
    };
    const handleClick = (e: MouseEvent) => {
      if (
        e.target instanceof Element &&
        e.target.closest("[data-asset-library-dialog]")
      ) {
        return;
      }
      if (
        !renameTarget &&
        !storagePromptOpen &&
        panelRef.current &&
        !panelRef.current.contains(e.target as Node)
      ) {
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [open, onOpenChange, renameTarget, storagePromptOpen]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (!fileStorageConfigured) {
      e.target.value = "";
      return;
    }
    setUploading(true);
    const failures: string[] = [];
    let storageSetupRequired = false;
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        try {
          const res = await fetch(`${appBasePath()}/api/assets/upload`, {
            method: "POST",
            body: form,
          });
          if (!res.ok) {
            // coercion-ok: the HTTP status records failure; its optional error detail may not be JSON.
            const body = await res.json().catch(() => null);
            const errorCode = body?.errorCode;
            if (isAssetStorageSetupError(errorCode)) {
              storageSetupRequired = true;
            }
            failures.push(
              t(
                `raw.assetErrors.${assetErrorTranslationKey(errorCode, "upload")}`,
              ),
            );
          }
        } catch {
          failures.push(t("raw.assetErrors.uploadFailed"));
        }
      }
      await assetsQuery.refetch();
      if (storageSetupRequired) {
        const status = await storageQuery.refetch();
        if (status.isSuccess && status.data.referenceStorageReady === true) {
          toast.error(t("raw.assetUploadFailed"), {
            description: t("home.fileStorageSetupRequired"),
          });
        } else {
          setStoragePromptOpen(true);
        }
        return;
      }
      if (failures.length > 0) {
        toast.error(t("raw.assetUploadFailed"), {
          description: failures.join("\n"),
        });
      }
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const requestUpload = () => {
    if (uploading) return;
    if (fileStorageConfigured) uploadInputRef.current?.click();
    else setStoragePromptOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteAsset.mutateAsync({ id });
      await assetsQuery.refetch();
    } catch {
      toast.error(t("raw.assetDeleteFailed"));
    }
  };

  const openRename = (asset: Asset) => {
    setRenameTarget(asset);
    setRenameFilename(asset.filename);
  };

  const handleRename = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!renameTarget) return;
    const filename = renameFilename.trim();
    if (!filename || filename === renameTarget.filename) {
      setRenameTarget(null);
      return;
    }
    setRenaming(true);
    try {
      await updateAsset.mutateAsync({ id: renameTarget.id, filename });
      await assetsQuery.refetch();
      setRenameTarget(null);
    } catch {
      toast.error(t("raw.assetUpdateFailed"));
    } finally {
      setRenaming(false);
    }
  };

  const requestReplace = (asset: Asset) => {
    if (!fileStorageConfigured) {
      setStoragePromptOpen(true);
      return;
    }
    setReplaceTarget(asset);
    replaceInputRef.current?.click();
  };

  const handleReplaceUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    const target = replaceTarget;
    if (!file || !target) {
      e.target.value = "";
      setReplaceTarget(null);
      return;
    }
    if (!fileStorageConfigured) {
      e.target.value = "";
      setReplaceTarget(null);
      setStoragePromptOpen(true);
      return;
    }

    setReplacingId(target.id);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`${appBasePath()}/api/assets/upload`, {
        method: "POST",
        body: form,
      });
      // coercion-ok: unreadable upload JSON yields no id, so the required-id check reports failure.
      const body: unknown = await response.json().catch(() => null);
      const result =
        body && typeof body === "object"
          ? (body as { id?: unknown; errorCode?: unknown })
          : null;
      if (!response.ok) {
        if (isAssetStorageSetupError(result?.errorCode)) {
          const status = await storageQuery.refetch();
          if (status.isSuccess && status.data.referenceStorageReady === true) {
            toast.error(t("raw.assetUploadFailed"), {
              description: t("home.fileStorageSetupRequired"),
            });
          } else {
            setStoragePromptOpen(true);
          }
        } else {
          toast.error(t("raw.assetUploadFailed"), {
            description: t(
              `raw.assetErrors.${assetErrorTranslationKey(result?.errorCode, "upload")}`,
            ),
          });
        }
        return;
      }
      if (typeof result?.id !== "string" || !result.id) {
        toast.error(t("raw.assetUploadFailed"));
        return;
      }

      const updated = await updateAsset.mutateAsync({
        id: target.id,
        replacementId: result.id,
      });
      await assetsQuery.refetch();
      if (updated.cleanupWarning) {
        toast.error(t("raw.assetCleanupFailed"));
      }
    } catch {
      await assetsQuery.refetch();
      toast.error(t("raw.assetUpdateFailed"));
    } finally {
      setReplacingId(null);
      setReplaceTarget(null);
      e.target.value = "";
    }
  };

  const handleSelect = (url: string) => {
    onSelectAsset?.(url);
    onOpenChange(false);
  };

  if (!open) return null;

  let style: React.CSSProperties = {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    zIndex: 9999,
  };

  if (anchorRef?.current) {
    const rect = anchorRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    if (vw < 640) {
      style = {
        position: "fixed",
        top: rect.bottom + 8,
        left: 12,
        right: 12,
        zIndex: 9999,
      };
    } else {
      style = {
        position: "fixed",
        top: rect.bottom + 8,
        right: Math.max(8, vw - rect.right),
        zIndex: 9999,
      };
    }
  }

  return createPortal(
    <div
      ref={panelRef}
      style={style}
      className="w-[min(20rem,calc(100vw-24px))] max-h-[420px] bg-popover border border-border rounded-xl shadow-2xl shadow-black/60 overflow-hidden flex flex-col"
    >
      <div className="px-4 pt-3 pb-2 flex items-center justify-between flex-shrink-0">
        <h3 className="text-sm font-semibold text-foreground">
          {t("editorToolbar.assetLibrary")}
        </h3>
        <button
          onClick={() => onOpenChange(false)}
          className="text-muted-foreground/70 hover:text-muted-foreground transition-colors"
          aria-label={t("comments.close")}
        >
          <IconX className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 pb-4 space-y-3 overflow-y-auto flex-1">
        {/* Upload */}
        <button
          type="button"
          onClick={requestUpload}
          disabled={uploading}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 transition-colors hover:border-primary/40 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          {uploading ? (
            <IconLoader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
          ) : (
            <IconUpload className="w-3.5 h-3.5 text-muted-foreground" />
          )}
          <span className="text-xs text-muted-foreground">
            {uploading ? t("raw.uploading") : t("openSlideEditor.uploadImage")}
          </span>
        </button>
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*,.svg"
          multiple
          onChange={handleUpload}
          className="hidden"
          disabled={uploading || !fileStorageConfigured}
        />
        <input
          ref={replaceInputRef}
          type="file"
          accept="image/*,.svg"
          onChange={handleReplaceUpload}
          className="hidden"
          disabled={replacingId !== null || !fileStorageConfigured}
        />
        <UploadStorageGate
          configured={fileStorageConfigured}
          unavailable={!storageQuery.isSuccess}
          open={storagePromptOpen}
          onOpenChange={setStoragePromptOpen}
          onRetry={() => void storageQuery.refetch()}
        />

        {/* Grid */}
        {assetsQuery.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <IconLoader2 className="w-4 h-4 text-muted-foreground animate-spin" />
          </div>
        ) : assets.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-xs">
            {t("raw.noAssetsYet")}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className="group relative aspect-square rounded-md overflow-hidden border border-border bg-muted"
              >
                <button
                  onClick={
                    onSelectAsset ? () => handleSelect(asset.url) : undefined
                  }
                  className={`w-full h-full ${onSelectAsset ? "cursor-pointer hover:ring-2 hover:ring-primary/50" : "cursor-default"}`}
                >
                  <img
                    src={asset.url}
                    alt={asset.filename}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    openRename(asset);
                  }}
                  className="absolute top-0.5 left-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground/70 text-background/80 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-background"
                  aria-label={t("deckCard.rename")}
                  title={t("deckCard.rename")}
                >
                  <IconPencil className="h-2.5 w-2.5" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    requestReplace(asset);
                  }}
                  disabled={replacingId !== null}
                  className="absolute top-0.5 left-6 flex h-5 w-5 items-center justify-center rounded-full bg-foreground/70 text-background/80 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-background disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={t("contextToolbar.replaceImage")}
                  title={t("contextToolbar.replaceImage")}
                >
                  {replacingId === asset.id ? (
                    <IconLoader2 className="h-2.5 w-2.5 animate-spin" />
                  ) : (
                    <IconRefresh className="h-2.5 w-2.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDelete(asset.id);
                  }}
                  className="absolute top-0.5 right-0.5 w-5 h-5 bg-foreground/70 text-background/70 hover:text-destructive flex items-center justify-center rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label={t("raw.deleteAsset", {
                    filename: asset.filename,
                  })}
                >
                  <IconTrash className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open && !renaming) setRenameTarget(null);
        }}
      >
        <DialogContent data-asset-library-dialog>
          <DialogHeader>
            <DialogTitle>{t("deckCard.rename")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void handleRename(e)} className="space-y-4">
            <Input
              autoFocus
              required
              maxLength={255}
              value={renameFilename}
              onChange={(e) => setRenameFilename(e.target.value)}
              aria-label={t("deckCard.rename")}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameTarget(null)}
                disabled={renaming}
              >
                {t("comments.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={renaming || !renameFilename.trim()}
              >
                {renaming ? t("raw.uploading") : t("deckCard.rename")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>,
    document.body,
  );
}
