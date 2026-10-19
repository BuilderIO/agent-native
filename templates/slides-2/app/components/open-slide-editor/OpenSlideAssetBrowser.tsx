import { appBasePath } from "@agent-native/core/client/api-path";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconPencil,
  IconPhoto,
  IconRefresh,
  IconSearch,
  IconUpload,
  IconVideo,
} from "@tabler/icons-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { UploadStorageGate } from "@/components/editor/UploadStorageGate";
import { OpenSlideSvglLogoSearchDialog } from "@/components/open-slide-editor/OpenSlideSvglLogoSearchDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSlideFileStorageStatus } from "@/hooks/use-slide-file-storage-status";
import {
  assetErrorTranslationKey,
  isAssetStorageSetupError,
} from "@/lib/asset-error-copy";

type UploadedAsset = {
  id: string;
  url: string;
  filename: string;
  size: number;
  createdAt: string;
  type: string;
};

type MediaFilter = "all" | "image" | "video";

function isVideoFile(file: File): boolean {
  const type = file.type.toLocaleLowerCase();
  const name = file.name.toLocaleLowerCase();
  return (
    type === "video/mp4" ||
    type === "video/webm" ||
    name.endsWith(".mp4") ||
    name.endsWith(".webm")
  );
}

function isSupportedAssetFile(file: File): boolean {
  return file.type.startsWith("image/") || isVideoFile(file);
}

type Props = {
  deckId: string;
  slideId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canInsert: boolean;
  onInsert: (
    assetId: string,
    filename: string,
    type: string,
  ) => Promise<string | null>;
};

export function OpenSlideAssetBrowser({
  deckId,
  slideId,
  open,
  onOpenChange,
  canInsert,
  onInsert,
}: Props) {
  const t = useT();
  const [scope, setScope] = useState<"slide" | "deck" | "global">("slide");
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const storageQuery = useSlideFileStorageStatus(open);
  const storageConfigured =
    storageQuery.data?.configured === true && !storageQuery.isError;
  const assetsQuery = useActionQuery(
    "list-assets",
    scope === "slide"
      ? { scope, media: mediaFilter, deckId, slideId }
      : scope === "deck"
        ? { scope, media: mediaFilter, deckId }
        : { scope, media: mediaFilter },
    {
      enabled: open && (scope !== "slide" || Boolean(slideId)),
    },
  );
  const updateAsset = useActionMutation<
    { success: boolean; filename: string; cleanupWarning?: boolean },
    { id: string; filename?: string; replacementId?: string }
  >("update-asset");
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const uploadButtonRef = useRef<HTMLButtonElement>(null);
  const dragDepthRef = useRef(0);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [storagePromptOpen, setStoragePromptOpen] = useState(false);
  const [logoSearchOpen, setLogoSearchOpen] = useState(false);
  const [insertingAssetId, setInsertingAssetId] = useState<string | null>(null);
  const [insertError, setInsertError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<UploadedAsset | null>(null);
  const [renameFilename, setRenameFilename] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<UploadedAsset | null>(
    null,
  );
  const [replacingId, setReplacingId] = useState<string | null>(null);

  const assetErrorMessage = (
    errorCode: unknown,
    operation: "list" | "upload",
  ) =>
    operation === "list" && mediaFilter !== "image"
      ? t("openSlideEditor.assetsLoadFailed")
      : t(`raw.assetErrors.${assetErrorTranslationKey(errorCode, operation)}`);

  const requestLogoStorageSetup = async () => {
    setLogoSearchOpen(false);
    const status = await storageQuery.refetch();
    if (status.isSuccess && status.data.referenceStorageReady === true) {
      toast.error(t("raw.mediaUploadFailed"), {
        description: t("home.fileStorageSetupRequired"),
      });
    } else {
      setStoragePromptOpen(true);
    }
  };

  const assets = (assetsQuery.data ?? []).filter((asset) =>
    asset.filename
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );

  const uploadFiles = async (files: File[]) => {
    const uploads = files.filter(isSupportedAssetFile);
    if (uploads.length === 0) return;
    if (!storageConfigured) {
      setStoragePromptOpen(true);
      return;
    }

    setUploading(true);
    const failures: string[] = [];
    let storageSetupRequired = false;
    let uploadedAsset = false;
    try {
      for (const file of uploads) {
        const isVideo = isVideoFile(file);
        const form = new FormData();
        form.append("file", file);
        if (scope !== "global") form.append("deckId", deckId);
        try {
          const endpoint = isVideo
            ? "/api/assets/upload-video"
            : "/api/assets/upload";
          const response = await fetch(`${appBasePath()}${endpoint}`, {
            method: "POST",
            body: form,
          });
          // coercion-ok: HTTP status records failure; its optional error detail may not be JSON.
          const body = await response.json().catch(() => null);
          if (!response.ok) {
            const errorCode = body?.errorCode;
            if (
              isAssetStorageSetupError(errorCode) ||
              errorCode === "video_upload_storage_unavailable"
            ) {
              storageSetupRequired = true;
            }
            failures.push(
              isVideo
                ? t("openSlideEditor.videoUploadFailed")
                : assetErrorMessage(errorCode, "upload"),
            );
          } else {
            uploadedAsset = true;
          }
        } catch {
          failures.push(
            isVideo
              ? t("openSlideEditor.videoUploadFailed")
              : assetErrorMessage(undefined, "upload"),
          );
        }
      }

      await assetsQuery.refetch();
      if (uploadedAsset && scope === "slide") setScope("deck");
      if (storageSetupRequired) {
        const status = await storageQuery.refetch();
        if (status.isSuccess && status.data.referenceStorageReady === true) {
          toast.error(t("raw.mediaUploadFailed"), {
            description: t("home.fileStorageSetupRequired"),
          });
        } else {
          setStoragePromptOpen(true);
        }
      } else if (failures.length > 0) {
        toast.error(t("raw.mediaUploadFailed"), {
          description: failures.join("\n"),
        });
      }
    } finally {
      setUploading(false);
    }
  };

  const upload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    void uploadFiles(Array.from(input.files ?? [])).finally(() => {
      input.value = "";
    });
  };

  const chooseAsset = async (asset: UploadedAsset) => {
    setInsertError(null);
    setInsertingAssetId(asset.id);
    try {
      const error = await onInsert(asset.id, asset.filename, asset.type);
      if (error) {
        setInsertError(error);
        return;
      }
      onOpenChange(false);
    } catch {
      setInsertError(
        asset.type.startsWith("video/")
          ? t("openSlideEditor.videoInsertFailed")
          : t("openSlideEditor.imageInsertFailed"),
      );
    } finally {
      setInsertingAssetId(null);
    }
  };

  const openRename = (asset: UploadedAsset) => {
    setRenameTarget(asset);
    setRenameFilename(asset.filename);
  };

  const renameAsset = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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

  const requestReplace = (asset: UploadedAsset) => {
    if (!storageConfigured) {
      setStoragePromptOpen(true);
      return;
    }
    setReplaceTarget(asset);
    replaceInputRef.current?.click();
  };

  const replaceAsset = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    const target = replaceTarget;
    if (!file || !target) {
      input.value = "";
      setReplaceTarget(null);
      return;
    }
    if (!storageConfigured) {
      input.value = "";
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
            toast.error(t("raw.mediaUploadFailed"), {
              description: t("home.fileStorageSetupRequired"),
            });
          } else {
            setStoragePromptOpen(true);
          }
        } else {
          toast.error(t("raw.mediaUploadFailed"), {
            description: assetErrorMessage(result?.errorCode, "upload"),
          });
        }
        return;
      }
      if (typeof result?.id !== "string" || !result.id) {
        toast.error(t("raw.mediaUploadFailed"));
        return;
      }
      const updated = await updateAsset.mutateAsync({
        id: target.id,
        replacementId: result.id,
      });
      await assetsQuery.refetch();
      if (updated.cleanupWarning) toast.error(t("raw.assetCleanupFailed"));
    } catch {
      await assetsQuery.refetch();
      toast.error(t("raw.assetUpdateFailed"));
    } finally {
      setReplacingId(null);
      setReplaceTarget(null);
      input.value = "";
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setInsertError(null);
          onOpenChange(next);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t("editorToolbar.assetLibrary")}</DialogTitle>
          </DialogHeader>
          <Tabs
            value={scope}
            onValueChange={(value) =>
              setScope(value as "slide" | "deck" | "global")
            }
            className="space-y-3"
          >
            <TabsList className="h-[23px] justify-start rounded-[5px] bg-transparent p-0">
              <TabsTrigger
                value="slide"
                className="h-[23px] rounded-[5px] border border-transparent px-2 py-0 text-xs font-medium data-[state=active]:shadow-none"
              >
                {t("comments.thisSlide")}
              </TabsTrigger>
              <TabsTrigger
                value="deck"
                className="h-[23px] rounded-[5px] border border-transparent px-2 py-0 text-xs font-medium data-[state=active]:shadow-none"
              >
                {t("header.deck")}
              </TabsTrigger>
              <TabsTrigger
                value="global"
                className="h-[23px] rounded-[5px] border border-transparent px-2 py-0 text-xs font-medium data-[state=active]:shadow-none"
              >
                {t("editorToolbar.globalAssetScope")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value={scope} className="mt-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.currentTarget.value)}
                  placeholder={t("openSlideEditor.searchMediaPlaceholder")}
                  aria-label={t("openSlideEditor.searchMediaPlaceholder")}
                  className="min-w-48 flex-1"
                />
                <div
                  className="flex items-center gap-1"
                  role="group"
                  aria-label={t("openSlideEditor.mediaTypeFilter")}
                >
                  {(["all", "image", "video"] as const).map((filter) => (
                    <Button
                      key={filter}
                      type="button"
                      size="sm"
                      variant={mediaFilter === filter ? "secondary" : "ghost"}
                      aria-pressed={mediaFilter === filter}
                      onClick={() => setMediaFilter(filter)}
                    >
                      {t(`openSlideEditor.mediaFilters.${filter}`)}
                    </Button>
                  ))}
                </div>
                <Button
                  ref={uploadButtonRef}
                  type="button"
                  variant="outline"
                  disabled={!canInsert || uploading}
                  onClick={() => {
                    if (storageConfigured) uploadInputRef.current?.click();
                    else setStoragePromptOpen(true);
                  }}
                >
                  <IconUpload className="me-2 size-4" aria-hidden="true" />
                  {uploading
                    ? t("raw.uploading")
                    : t("openSlideEditor.uploadMedia")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLogoSearchOpen(true)}
                >
                  <IconSearch className="me-2 size-4" aria-hidden="true" />
                  {t("openSlideEditor.searchLogos")}
                </Button>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/*,video/mp4,video/webm"
                  multiple
                  className="hidden"
                  disabled={!canInsert || uploading}
                  onChange={(event) => void upload(event)}
                />
                <input
                  ref={replaceInputRef}
                  type="file"
                  accept="image/*,.svg"
                  className="hidden"
                  disabled={replacingId !== null || !storageConfigured}
                  onChange={(event) => void replaceAsset(event)}
                />
                <UploadStorageGate
                  configured={storageConfigured}
                  unavailable={!storageQuery.isSuccess}
                  open={storagePromptOpen}
                  onOpenChange={setStoragePromptOpen}
                  onRetry={() => void storageQuery.refetch()}
                  anchorRef={uploadButtonRef}
                />
              </div>
              {insertError ? (
                <p className="text-sm text-destructive" role="alert">
                  {insertError}
                </p>
              ) : null}
              <div
                className="relative"
                onDragEnter={(event) => {
                  if (
                    uploading ||
                    !canInsert ||
                    !event.dataTransfer.types.includes("Files")
                  ) {
                    return;
                  }
                  event.preventDefault();
                  dragDepthRef.current += 1;
                  setDragActive(true);
                }}
                onDragOver={(event) => {
                  if (
                    uploading ||
                    !canInsert ||
                    !event.dataTransfer.types.includes("Files")
                  ) {
                    return;
                  }
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }}
                onDragLeave={() => {
                  dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                  if (dragDepthRef.current === 0) setDragActive(false);
                }}
                onDrop={(event) => {
                  if (
                    uploading ||
                    !canInsert ||
                    !event.dataTransfer.types.includes("Files")
                  ) {
                    return;
                  }
                  event.preventDefault();
                  dragDepthRef.current = 0;
                  setDragActive(false);
                  void uploadFiles(Array.from(event.dataTransfer.files));
                }}
              >
                <ScrollArea className="h-[min(58vh,32rem)] rounded-md border border-border">
                  <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 md:grid-cols-4">
                    {assetsQuery.isLoading ? (
                      Array.from({ length: 8 }, (_, index) => (
                        <Skeleton
                          key={index}
                          className="aspect-square rounded-md"
                        />
                      ))
                    ) : assetsQuery.isError ? (
                      <div
                        role="alert"
                        className="col-span-full flex flex-col items-center gap-2 py-10 text-center text-sm text-destructive"
                      >
                        <p>
                          {assetErrorMessage(
                            (
                              assetsQuery.error as {
                                errorCode?: unknown;
                              } | null
                            )?.errorCode,
                            "list",
                          )}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={assetsQuery.isFetching}
                          onClick={() => void assetsQuery.refetch()}
                        >
                          {t("comments.retry")}
                        </Button>
                      </div>
                    ) : assets.length === 0 ? (
                      <p className="col-span-full flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
                        {mediaFilter === "video" ? (
                          <IconVideo className="size-6" aria-hidden="true" />
                        ) : (
                          <IconPhoto className="size-6" aria-hidden="true" />
                        )}
                        {search
                          ? t("openSlideEditor.noAssetsMatch")
                          : mediaFilter === "video"
                            ? t("openSlideEditor.noVideosYet")
                            : t("raw.noAssetsYet")}
                      </p>
                    ) : (
                      assets.map((asset) => (
                        <div
                          key={asset.id}
                          className="group min-w-0 overflow-hidden rounded-md border border-border bg-card"
                        >
                          <button
                            type="button"
                            disabled={!canInsert || insertingAssetId !== null}
                            onClick={() => void chooseAsset(asset)}
                            className="block w-full min-w-0 text-start transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                            aria-label={asset.filename}
                            title={asset.filename}
                          >
                            <span
                              className={`block overflow-hidden bg-muted ${asset.type.startsWith("video/") ? "aspect-video" : "aspect-square"}`}
                            >
                              {asset.type.startsWith("video/") ? (
                                <video
                                  src={asset.url}
                                  muted
                                  playsInline
                                  preload="metadata"
                                  aria-hidden="true"
                                  className="size-full object-contain"
                                />
                              ) : (
                                <img
                                  src={asset.url}
                                  alt=""
                                  loading="lazy"
                                  className="size-full object-contain transition-transform group-hover:scale-[1.02]"
                                />
                              )}
                            </span>
                            <span className="block truncate px-2 py-1.5 text-xs">
                              {insertingAssetId === asset.id
                                ? t("designSystemSetup.saving")
                                : asset.filename}
                            </span>
                          </button>
                          {scope === "global" &&
                          asset.type.startsWith("image/") ? (
                            <div className="flex justify-end gap-1 border-t border-border px-2 py-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                aria-label={t("deckCard.rename")}
                                title={t("deckCard.rename")}
                                disabled={renaming || replacingId !== null}
                                onClick={() => openRename(asset)}
                              >
                                <IconPencil
                                  className="size-4"
                                  aria-hidden="true"
                                />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                aria-label={t("contextToolbar.replaceImage")}
                                title={t("contextToolbar.replaceImage")}
                                disabled={renaming || replacingId !== null}
                                onClick={() => requestReplace(asset)}
                              >
                                {replacingId === asset.id ? (
                                  <IconUpload
                                    className="size-4 animate-pulse"
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <IconRefresh
                                    className="size-4"
                                    aria-hidden="true"
                                  />
                                )}
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
                {dragActive && (
                  <div className="pointer-events-none absolute inset-2 z-10 flex items-end justify-center rounded-md border border-dashed border-primary/50 bg-primary/5 p-4">
                    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium shadow-sm">
                      <IconUpload
                        className="size-4 text-primary"
                        aria-hidden="true"
                      />
                      {t("openSlideEditor.uploadMedia")}
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(next) => {
          if (!next && !renaming) setRenameTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deckCard.rename")}</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => void renameAsset(event)}
          >
            <Input
              autoFocus
              required
              maxLength={255}
              value={renameFilename}
              onChange={(event) => setRenameFilename(event.currentTarget.value)}
              aria-label={t("deckCard.rename")}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={renaming}
                onClick={() => setRenameTarget(null)}
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
      {logoSearchOpen ? (
        <OpenSlideSvglLogoSearchDialog
          open
          onOpenChange={setLogoSearchOpen}
          onStorageSetup={() => void requestLogoStorageSetup()}
          onInserted={() => onOpenChange(false)}
          deckId={scope === "global" ? undefined : deckId}
          canInsert={canInsert}
          storageConfigured={storageConfigured}
          onInsert={onInsert}
        />
      ) : null}
    </>
  );
}
