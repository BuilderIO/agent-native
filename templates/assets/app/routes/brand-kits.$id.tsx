import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import {
  type Dispatch,
  type DragEvent,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ShareButton,
  appBasePath,
  agentNativePath,
  sendToAgentChat,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import {
  IconDotsVertical,
  IconArchive,
  IconFolder,
  IconFolderPlus,
  IconMessageCircle,
  IconPencil,
  IconPhoto,
  IconPhotoPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUpload,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  chunkAssetUploads,
  getFailedUploadCount,
  getSkippedDuplicateCount,
  getUploadedAssetCount,
  type AssetUploadResult,
} from "@/lib/upload-results";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { EditLibraryDialog } from "@/components/library/EditLibraryDialog";
import { assetMediaUrl } from "@/lib/asset-urls";
import { assetPreviewSources } from "@/lib/asset-preview-sources";
import { getLibraryCustomInstructions } from "@/lib/libraries";
import {
  IMAGE_CATEGORIES,
  ASPECT_RATIOS,
  IMAGE_MODELS,
  IMAGE_SIZES,
  VIDEO_ASPECT_RATIOS,
  VIDEO_DURATIONS,
  VIDEO_MODELS,
  VIDEO_RESOLUTIONS,
} from "../../shared/api";

function candidateSaveKey(slot: any): string {
  if (typeof slot?.assetId === "string" && slot.assetId) {
    return `asset:${slot.assetId}`;
  }
  if (typeof slot?.slotId === "string" && slot.slotId) {
    return `slot:${slot.slotId}`;
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function markLibraryAssetSavedInCache(
  queryClient: QueryClient,
  libraryId: string,
  assetId: string,
  savedAsset: unknown,
) {
  const savedAssetRecord = isRecord(savedAsset) ? savedAsset : {};
  queryClient.setQueryData(
    ["action", "get-library", { id: libraryId }],
    (current: any) => {
      if (!current || !Array.isArray(current.assets)) return current;
      let changed = false;
      const assets = current.assets.map((asset: any) => {
        if (asset.id !== assetId) return asset;
        changed = true;
        const currentMetadata = isRecord(asset.metadata) ? asset.metadata : {};
        const savedMetadata = isRecord(savedAssetRecord.metadata)
          ? savedAssetRecord.metadata
          : {};
        return {
          ...asset,
          ...savedAssetRecord,
          status: "saved",
          metadata: { ...currentMetadata, ...savedMetadata },
        };
      });
      return changed ? { ...current, assets } : current;
    },
  );
}

function removeAssetsFromLibraryCache(
  queryClient: QueryClient,
  libraryId: string,
  assetIds: Array<string | null | undefined>,
) {
  const ids = new Set(
    assetIds.filter((id): id is string => typeof id === "string" && !!id),
  );
  if (ids.size === 0) return;
  queryClient.setQueryData(
    ["action", "get-library", { id: libraryId }],
    (current: any) => {
      if (!current || !Array.isArray(current.assets)) return current;
      const assets = current.assets.filter((asset: any) => !ids.has(asset.id));
      return assets.length === current.assets.length
        ? current
        : { ...current, assets };
    },
  );
}

function updateVariantSlotsInCache(
  queryClient: QueryClient,
  shouldRemove: (slot: any) => boolean,
) {
  queryClient.setQueryData(["app-state", "asset-variants"], (current: any) => {
    if (!current || !Array.isArray(current.slots)) return current;
    const slots = current.slots.filter((slot: any) => !shouldRemove(slot));
    if (slots.length === current.slots.length) return current;
    if (slots.length === 0) return null;
    return {
      ...current,
      slots,
      updatedAt: new Date().toISOString(),
    };
  });
}

function removeVariantSlotFromCache(queryClient: QueryClient, slot: any) {
  const slotId = typeof slot?.slotId === "string" ? slot.slotId : null;
  const assetId = typeof slot?.assetId === "string" ? slot.assetId : null;
  updateVariantSlotsInCache(
    queryClient,
    (candidate) =>
      (!!slotId && candidate.slotId === slotId) ||
      (!!assetId && candidate.assetId === assetId),
  );
}

function removeVariantSlotsByScopeFromCache(
  queryClient: QueryClient,
  scope: "failed" | "all",
) {
  updateVariantSlotsInCache(
    queryClient,
    (slot) => scope === "all" || slot.status === "failed",
  );
}

function variantSlotTime(slot: any): number {
  const raw = slot?.createdAt ?? slot?.updatedAt ?? "";
  const time = Date.parse(String(raw));
  return Number.isNaN(time) ? 0 : time;
}

function compareVariantSlotsNewestFirst(left: any, right: any): number {
  return (
    variantSlotTime(right) - variantSlotTime(left) ||
    String(right?.slotId ?? "").localeCompare(String(left?.slotId ?? ""))
  );
}

function stalePendingVariantRunId(slot: any): string | null {
  if (slot?.status !== "pending") return null;
  if (typeof slot?.runId !== "string" || !slot.runId) return null;
  const timestamp = variantSlotTime(slot);
  if (!timestamp) return null;
  return Date.now() - timestamp >= 2 * 60 * 1000 ? slot.runId : null;
}

function paletteDraftFromColors(colors: unknown): string {
  return Array.isArray(colors)
    ? colors.filter((color) => typeof color === "string").join(", ")
    : "";
}

function parsePaletteDraft(value: string): string[] {
  const seen = new Set<string>();
  const colors: string[] = [];
  for (const raw of value.split(/[\s,]+/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const color = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) continue;
    const normalized = color.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    colors.push(normalized);
  }
  return colors;
}

function libraryTabFromValue(value: unknown): LibraryTab | null {
  return value === "references" ||
    value === "generated" ||
    value === "runs" ||
    value === "settings"
    ? value
    : null;
}

export default function LibraryPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlTab = libraryTabFromValue(searchParams.get("tab"));
  const libraryId = id!;
  const { data } = useActionQuery("get-library", { id: libraryId }) as any;
  const updateLibrary = useActionMutation("update-library");
  const archiveLibrary = useActionMutation("archive-library");
  const saveGenerated = useActionMutation("save-generated-image");
  const rerunGeneration = useActionMutation("rerun-generation-run");
  const refreshGeneration = useActionMutation("refresh-generation-run");
  const createSession = useActionMutation("create-generation-session");
  const prepareSessionContinuation = useActionMutation(
    "prepare-generation-session-continuation",
  );
  const { data: variants } = useVariantState();
  const { data: presetData } = useActionQuery("list-generation-presets", {
    libraryId,
  }) as any;
  const { data: sessionData } = useActionQuery("list-generation-sessions", {
    libraryId,
  }) as any;
  const queryClient = useQueryClient();
  const [generateOpen, setGenerateOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [activeFolderId, setActiveFolderId] = useState<string | null>("all");
  const [activeTab, setActiveTab] = useState<LibraryTab>(
    () => urlTab ?? "references",
  );
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [optimisticallyDeletedAssetIds, setOptimisticallyDeletedAssetIds] =
    useState<Set<string>>(() => new Set());
  const [optimisticallySavedAssetIds, setOptimisticallySavedAssetIds] =
    useState<Set<string>>(() => new Set());
  const [savingCandidateKeys, setSavingCandidateKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [mediaFilter, setMediaFilter] = useState<"all" | "image" | "video">(
    "all",
  );
  const [search, setSearch] = useState("");
  const [styleDescriptionDraft, setStyleDescriptionDraft] = useState("");
  const [customInstructionsDraft, setCustomInstructionsDraft] = useState("");
  const [paletteDraft, setPaletteDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refreshingVariantRunIdsRef = useRef<Set<string>>(new Set());
  const dragCounterRef = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const createFolder = useActionMutation("create-folder");

  useEffect(() => {
    if (!urlTab) return;
    setActiveTab((current) => (current === urlTab ? current : urlTab));
  }, [urlTab]);

  useEffect(() => {
    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-request-source": "assets-library-ui",
      },
      body: JSON.stringify({
        view: "library",
        libraryId,
        activeTab,
        selectedAssetIds: Array.from(selectedAssetIds),
      }),
    }).catch(() => {});
  }, [activeTab, libraryId, selectedAssetIds]);

  const library = data?.library;
  const folders = (data?.folders ?? []) as any[];
  const generationPresets = ((presetData as any)?.presets ?? []) as any[];
  const generationSessions = ((sessionData as any)?.sessions ?? []) as any[];
  const serverAssets = (data?.assets ?? []) as any[];
  const savedCandidateAssetIds = new Set(
    serverAssets
      .filter(
        (asset) =>
          asset.status === "saved" || optimisticallySavedAssetIds.has(asset.id),
      )
      .map((asset) => asset.id),
  );
  const assets = serverAssets
    .map((asset) =>
      optimisticallySavedAssetIds.has(asset.id)
        ? { ...asset, status: "saved" }
        : asset,
    )
    .filter((asset) => !optimisticallyDeletedAssetIds.has(asset.id));
  const visibleAssets = assets.filter((asset) => {
    if (activeFolderId !== "all") {
      if (activeFolderId === null && asset.folderId) return false;
      if (activeFolderId && asset.folderId !== activeFolderId) return false;
    }
    if (mediaFilter !== "all" && asset.mediaType !== mediaFilter) return false;
    const normalized = search.trim().toLowerCase();
    if (!normalized) return true;
    return [
      asset.title,
      assetDisplayTitle(asset),
      assetLineageLabel(asset),
      asset.description,
      asset.altText,
      asset.prompt,
      asset.mimeType,
      asset.status,
      asset.role,
      assetCategoryLabel(asset),
      asset.metadata?.intent,
      asset.metadata?.description,
      asset.metadata?.prompt,
      asset.metadata?.originalName,
    ]
      .filter((value): value is string => typeof value === "string")
      .join("\n")
      .toLowerCase()
      .includes(normalized);
  });
  const references = visibleAssets.filter(
    (asset) => asset.status === "reference" && !isContentOnlyReference(asset),
  );
  const generated = visibleAssets.filter((asset) => asset.role === "generated");
  const saved = generated.filter((asset) => asset.status === "saved");
  const candidates = generated.filter((asset) => asset.status === "candidate");
  const unfiledCount = assets.filter((asset) => !asset.folderId).length;
  const customInstructions = getLibraryCustomInstructions(library);
  const libraryStyleDescription = library?.styleBrief?.description ?? "";
  const libraryPaletteDraft = paletteDraftFromColors(
    library?.styleBrief?.palette,
  );

  useEffect(() => {
    setStyleDescriptionDraft(libraryStyleDescription);
  }, [library?.id, libraryStyleDescription]);

  useEffect(() => {
    setCustomInstructionsDraft(customInstructions ?? "");
  }, [library?.id, customInstructions]);

  useEffect(() => {
    setPaletteDraft(libraryPaletteDraft);
  }, [library?.id, libraryPaletteDraft]);
  const pendingVisibleUploads = pendingUploads.filter((upload) => {
    if (mediaFilter !== "all" && upload.mediaType !== mediaFilter) return false;
    if (activeFolderId === "all") return true;
    if (activeFolderId === null) return !upload.folderId;
    return upload.folderId === activeFolderId;
  });

  const pendingVariants =
    variants?.libraryId === libraryId
      ? (variants.slots ?? [])
          .filter(
            (slot: any) =>
              !slot.assetId || !savedCandidateAssetIds.has(slot.assetId),
          )
          .sort(compareVariantSlotsNewestFirst)
      : [];

  useEffect(() => {
    if (refreshGeneration.isPending) return;
    const runId = pendingVariants
      .map(stalePendingVariantRunId)
      .find((id: string | null): id is string =>
        Boolean(id && !refreshingVariantRunIdsRef.current.has(id)),
      );
    if (!runId) return;
    refreshingVariantRunIdsRef.current.add(runId);
    refreshGeneration.mutate(
      { runId },
      {
        onSettled: () => {
          window.setTimeout(() => {
            refreshingVariantRunIdsRef.current.delete(runId);
          }, 30_000);
          void queryClient.invalidateQueries({
            queryKey: ["app-state", "asset-variants"],
            refetchType: "active",
          });
        },
      },
    );
  }, [pendingVariants, queryClient, refreshGeneration]);

  function markAssetsOptimisticallyDeleted(ids: string[]) {
    setOptimisticallyDeletedAssetIds((current) => {
      const next = new Set(current);
      for (const id of ids) next.add(id);
      return next;
    });
  }

  function restoreOptimisticallyDeletedAssets(ids: string[]) {
    setOptimisticallyDeletedAssetIds((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });
  }

  useEffect(() => {
    setOptimisticallyDeletedAssetIds((current) => {
      const serverAssetIds = new Set(serverAssets.map((asset) => asset.id));
      const next = new Set(
        [...current].filter((assetId) => serverAssetIds.has(assetId)),
      );
      return next.size === current.size ? current : next;
    });
  }, [serverAssets]);

  useEffect(() => {
    setOptimisticallySavedAssetIds((current) => {
      if (current.size === 0) return current;
      const serverStatusById = new Map(
        serverAssets.map((asset) => [asset.id, asset.status]),
      );
      const next = new Set(
        [...current].filter((assetId) => {
          const status = serverStatusById.get(assetId);
          return status !== undefined && status !== "saved";
        }),
      );
      return next.size === current.size ? current : next;
    });
  }, [serverAssets]);

  function setCandidateSaving(key: string, saving: boolean) {
    setSavingCandidateKeys((current) => {
      const next = new Set(current);
      if (saving) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next.size === current.size ? current : next;
    });
  }

  async function handleSaveCandidate(slot: any) {
    const key = candidateSaveKey(slot);
    if (!key || savingCandidateKeys.has(key)) return;

    setCandidateSaving(key, true);
    try {
      const savedAsset = await saveGenerated.mutateAsync({
        ...(slot.assetId ? { assetId: slot.assetId } : {}),
        ...(slot.slotId ? { slotId: slot.slotId } : {}),
      });
      const savedAssetId =
        typeof (savedAsset as any)?.id === "string"
          ? (savedAsset as any).id
          : slot.assetId;

      if (savedAssetId) {
        setOptimisticallySavedAssetIds((current) => {
          const next = new Set(current);
          next.add(savedAssetId);
          return next;
        });
        markLibraryAssetSavedInCache(
          queryClient,
          libraryId,
          savedAssetId,
          savedAsset,
        );
      }
      removeVariantSlotFromCache(queryClient, slot);
      void queryClient.invalidateQueries({
        queryKey: ["app-state", "asset-variants"],
        refetchType: "active",
      });
      toast.success("Saved to Generated.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save candidate.",
      );
    } finally {
      setCandidateSaving(key, false);
    }
  }

  useEffect(() => {
    const selectableAssets =
      activeTab === "references"
        ? references
        : activeTab === "generated"
          ? [...candidates, ...saved]
          : [];
    const selectableIds = new Set(selectableAssets.map((asset) => asset.id));
    setSelectedAssetIds((current) => {
      const next = new Set(
        [...current].filter((assetId) => selectableIds.has(assetId)),
      );
      return next.size === current.size ? current : next;
    });
  }, [activeTab, references, candidates, saved]);

  useEffect(() => {
    fetch(agentNativePath("/_agent-native/application-state/navigation"), {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-request-source": "assets-ui",
      },
      body: JSON.stringify({
        view: "library",
        libraryId,
        activeTab,
        folderId: activeFolderId,
        mediaFilter,
        search,
        selectedAssetIds: [...selectedAssetIds],
      }),
    }).catch(() => {});
  }, [
    activeFolderId,
    activeTab,
    libraryId,
    mediaFilter,
    search,
    selectedAssetIds,
  ]);

  function refreshLibrary() {
    return queryClient
      .invalidateQueries({ queryKey: ["action", "get-library"] })
      .then(() =>
        queryClient.refetchQueries({
          queryKey: ["action", "get-library"],
          type: "active",
        }),
      );
  }

  function analyzeBrand() {
    if (!library) return;
    const anchorIds = assets
      .filter(
        (asset) =>
          asset.metadata?.isStyleAnchor ||
          library.settings?.canonicalStyleAssetIds?.includes(asset.id),
      )
      .map((asset) => asset.id);
    sendToAgentChat({
      message: [
        "Analyze this Assets library brand.",
        `Call analyze-collection-style with libraryId: ${library.id}.`,
        "Update the reusable style brief with palette and visual traits, then summarize what changed.",
      ].join("\n"),
      context: [
        "## Assets library context",
        `Library: ${library.title} (${library.id})`,
        `Description: ${library.description || ""}`,
        `Reference assets: ${references.length}`,
        `Anchor assets: ${anchorIds.length ? anchorIds.join(", ") : "none"}`,
        `Current style brief: ${JSON.stringify(library.styleBrief ?? {})}`,
        customInstructions
          ? `Custom instructions: ${customInstructions}`
          : "Custom instructions: none",
      ].join("\n"),
      submit: true,
      newTab: true,
    });
  }

  async function upload(files: FileList | null, category = "style-only") {
    if (!files?.length || uploading) return;
    const selectedFiles = Array.from(files);
    const uploadChunks = chunkAssetUploads(selectedFiles);
    const selectedFolderId =
      activeFolderId && activeFolderId !== "all" ? activeFolderId : null;
    const pending: PendingUpload[] = selectedFiles.map((file, index) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
      name: file.name,
      mediaType: file.type.startsWith("video/") ? "video" : "image",
      folderId: selectedFolderId,
      status: "uploading" as const,
    }));
    const pendingByFile = new Map(
      selectedFiles.map((file, index) => [file, pending[index]]),
    );
    const removePendingFiles = (uploadedFiles: File[]) => {
      const completedIds = new Set(
        uploadedFiles
          .map((file) => pendingByFile.get(file)?.id)
          .filter((id): id is string => typeof id === "string"),
      );
      setPendingUploads((current) =>
        current.filter((upload) => !completedIds.has(upload.id)),
      );
    };
    setPendingUploads(pending);
    setUploading(true);
    let keepPending = false;
    const toastId = toast.loading(
      `Uploading ${selectedFiles.length} asset${selectedFiles.length === 1 ? "" : "s"}...`,
      {
        description:
          uploadChunks.length > 1
            ? `Processing in ${uploadChunks.length} batches.`
            : "Processing previews and saving them to the brand kit.",
      },
    );
    try {
      let uploadedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;
      for (const chunk of uploadChunks) {
        const form = new FormData();
        form.append("libraryId", libraryId);
        form.append("category", category);
        if (selectedFolderId) {
          form.append("folderId", selectedFolderId);
        }
        for (const file of chunk) form.append("files", file);
        const response = await fetch(`${appBasePath()}/api/assets/upload`, {
          method: "POST",
          body: form,
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(body?.error || `Upload failed (${response.status})`);
        }
        const result = (await response
          .json()
          .catch(() => null)) as AssetUploadResult | null;
        uploadedCount += getUploadedAssetCount(result);
        skippedCount += getSkippedDuplicateCount(result);
        failedCount += getFailedUploadCount(result);
        removePendingFiles(chunk);
      }
      if (failedCount > 0) {
        toast.warning(
          `Uploaded ${uploadedCount} asset${uploadedCount === 1 ? "" : "s"}; ${failedCount} failed.`,
          {
            id: toastId,
            description:
              skippedCount > 0
                ? `Skipped ${skippedCount} duplicate${skippedCount === 1 ? "" : "s"}.`
                : null,
          },
        );
      } else if (uploadedCount > 0 && skippedCount > 0) {
        toast.success(
          `Uploaded ${uploadedCount} asset${uploadedCount === 1 ? "" : "s"}; skipped ${skippedCount} duplicate${skippedCount === 1 ? "" : "s"}.`,
          { id: toastId, description: null },
        );
      } else if (uploadedCount > 0) {
        toast.success(
          `Uploaded ${uploadedCount} asset${uploadedCount === 1 ? "" : "s"}.`,
          {
            id: toastId,
            description: null,
          },
        );
      } else if (skippedCount > 0) {
        toast.warning(
          `Skipped ${skippedCount} duplicate asset${
            skippedCount === 1 ? "" : "s"
          }.`,
          {
            id: toastId,
            description: "Already in this brand kit.",
          },
        );
      } else {
        toast.warning("No new assets were uploaded.", {
          id: toastId,
          description: null,
        });
      }
      await refreshLibrary();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Upload failed";
      const indeterminate =
        /(?:\b408\b|\b504\b|timeout|timed out|network|failed to fetch|load failed)/i.test(
          message,
        );
      if (indeterminate) {
        keepPending = true;
        setPendingUploads(
          pending.map((upload) => ({ ...upload, status: "checking" })),
        );
        toast.warning("Upload is taking longer than expected.", {
          id: toastId,
          description:
            "The server may still finish saving these assets. We will keep checking this brand kit.",
        });
        void refreshLibrary();
        window.setTimeout(() => void refreshLibrary(), 4_000);
        window.setTimeout(() => {
          void refreshLibrary();
          setPendingUploads([]);
        }, 12_000);
      } else {
        toast.error(message, { id: toastId, description: null });
      }
    } finally {
      setUploading(false);
      if (!keepPending) setPendingUploads([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function archiveCurrentLibrary() {
    if (!library || archiveLibrary.isPending) return;
    try {
      await archiveLibrary.mutateAsync({ id: library.id });
      toast.success("Brand kit archived.");
      navigate("/brand-kits");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not archive brand kit.",
      );
    }
  }

  function generate(prompt: string, options: GenerateOptions) {
    const selectedPreset = options.presetId
      ? generationPresets.find((preset) => preset.id === options.presetId)
      : null;
    const trimmedPrompt = prompt.trim();
    const chatMessage =
      trimmedPrompt ||
      (options.mediaType === "video"
        ? "Generate a video for this library."
        : "Generate images for this library.");
    const context = [
      "## Assets library context",
      options.mediaType === "video"
        ? "Requested output: 1 video candidate for this library"
        : `Requested output: ${options.count} image candidate${options.count === 1 ? "" : "s"} for this library`,
      `User prompt: ${trimmedPrompt || "(no text prompt provided)"}`,
      options.presetId ? `Preset ID: ${options.presetId}` : "Preset ID: none",
      `Aspect ratio: ${options.aspectRatio}`,
      options.mediaType === "video"
        ? `Duration: ${options.durationSeconds}s\nResolution: ${options.resolution}`
        : `Image size: ${options.imageSize}`,
      `Model: ${options.model}`,
      activeFolderId && activeFolderId !== "all"
        ? `Folder ID: ${activeFolderId}`
        : "Folder ID: none",
      `Reference categories: ${options.category}`,
      `Include canonical logo: ${options.includeLogo ? "yes" : "no"}`,
      "",
      "## Selected library",
      `Library: ${library.title} (${library.id})`,
      `Description: ${library.description || ""}`,
      `Folder: ${activeFolderId && activeFolderId !== "all" ? folders.find((folder) => folder.id === activeFolderId)?.title : "All assets"}`,
      `References: ${references.length}`,
      `Saved assets: ${saved.length}`,
      `Style brief: ${JSON.stringify(library.styleBrief ?? {})}`,
      customInstructions
        ? `Custom instructions: ${customInstructions}`
        : "Custom instructions: none",
      selectedPreset
        ? `Generation preset: ${selectedPreset.title} (${selectedPreset.id}); ${selectedPreset.aspectRatio}; text policy: ${selectedPreset.textPolicy || "none"}`
        : "Generation preset: none",
      "",
      options.mediaType === "video"
        ? "Use generate-video, then call refresh-generation-run until the run completes and returns a video asset. Use save-generated-asset when the user approves it."
        : "Use the asset generation actions. If a generation preset ID is present, pass presetId to generate-image or generate-image-batch. Generate candidates, show previews, ask for feedback, and refine by assetId until the user is happy.",
    ].join("\n");
    sendToAgentChat({
      message: chatMessage,
      context,
      submit: true,
      newTab: true,
    });
    setGenerateOpen(false);
  }

  function continueSession(sessionId: string) {
    prepareSessionContinuation.mutate(
      { id: sessionId },
      {
        onSuccess: (payload: any) => {
          sendToAgentChat({
            message: payload.message,
            context: payload.context,
            submit: true,
            newTab: true,
          });
        },
        onError: (error: Error) => {
          toast.error(error.message || "Could not prepare handoff.");
        },
      },
    );
  }

  function createHandoffFromRun(run: any) {
    const outputIds = outputAssetIds(run);
    if (!outputIds.length) {
      toast.error("This run does not have generated assets to hand off.");
      return;
    }
    const prompt = run.originalPrompt || run.prompt || "Generated asset";
    createSession.mutate(
      {
        libraryId,
        collectionId: run.collectionId ?? null,
        presetId: run.presetId ?? null,
        title: prompt.slice(0, 80),
        brief: prompt,
        activeAssetId: outputIds[0],
        assetIds: outputIds,
        runIds: [run.id],
        feedback: "Needs design refinement.",
      },
      {
        onSuccess: () => toast.success("Handoff session created."),
        onError: (error: Error) => {
          toast.error(error.message || "Could not create handoff.");
        },
      },
    );
  }

  if (!library) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Loading brand kit...
      </div>
    );
  }
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border px-6 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-2xl font-semibold tracking-tight">
                {library.title}
              </h2>
              <Badge variant="outline">{library.visibility}</Badge>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => setEditOpen(true)}
                aria-label="Edit brand kit name and description"
              >
                <IconPencil className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {library.description ||
                "Upload, generate, describe, and organize reusable assets across agents."}
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap lg:shrink-0">
            <ShareButton
              resourceType="asset-library"
              resourceId={library.id}
              resourceTitle={library.title}
            />
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <IconUpload className="h-4 w-4" />
              )}
              {uploading ? `Uploading ${pendingUploads.length}` : "Upload"}
            </Button>
            <Button
              variant="outline"
              className="hidden gap-2 xl:inline-flex"
              onClick={() => setFolderOpen(true)}
            >
              <IconFolderPlus className="h-4 w-4" />
              Folder
            </Button>
            <GeneratePopover
              open={generateOpen}
              onOpenChange={setGenerateOpen}
              onSubmit={generate}
              hasLogo={!!library.canonicalLogoAssetId}
              presets={generationPresets}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Brand kit actions"
                  disabled={archiveLibrary.isPending}
                >
                  <IconDotsVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="xl:hidden"
                  onSelect={(event) => {
                    event.preventDefault();
                    setFolderOpen(true);
                  }}
                >
                  <IconFolderPlus className="mr-2 h-4 w-4 shrink-0" />
                  New folder
                </DropdownMenuItem>
                <DropdownMenuSeparator className="xl:hidden" />
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault();
                    setArchiveOpen(true);
                  }}
                >
                  <IconArchive className="mr-2 h-4 w-4 shrink-0" />
                  Archive brand kit
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif,video/mp4,video/quicktime,video/x-m4v,video/webm"
        multiple
        className="hidden"
        onChange={(event) => upload(event.target.files)}
      />

      <EditLibraryDialog
        library={library}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this brand kit?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the brand kit from the main Brand Kits list. Its
              assets and generation history stay stored.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={archiveLibrary.isPending}
              onClick={() => {
                void archiveCurrentLibrary();
              }}
            >
              {archiveLibrary.isPending ? "Archiving..." : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {folderOpen ? (
        <CreateFolderDialog
          open={folderOpen}
          onOpenChange={setFolderOpen}
          onSubmit={async (title) => {
            const folder = (await createFolder.mutateAsync({
              libraryId,
              title,
              parentId:
                activeFolderId && activeFolderId !== "all"
                  ? activeFolderId
                  : null,
            })) as any;
            setFolderOpen(false);
            if (folder?.id) setActiveFolderId(folder.id);
          }}
          pending={createFolder.isPending}
        />
      ) : null}

      <div
        className="relative flex-1 overflow-y-auto px-6 py-5"
        onDragEnter={(e: DragEvent<HTMLDivElement>) => {
          if (!e.dataTransfer.types.includes("Files")) return;
          e.preventDefault();
          dragCounterRef.current += 1;
          if (dragCounterRef.current === 1) setIsDragOver(true);
        }}
        onDragLeave={() => {
          dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
          if (dragCounterRef.current === 0) setIsDragOver(false);
        }}
        onDragOver={(e: DragEvent<HTMLDivElement>) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e: DragEvent<HTMLDivElement>) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          dragCounterRef.current = 0;
          setIsDragOver(false);
          void upload(e.dataTransfer.files);
        }}
      >
        {isDragOver && (
          <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-primary bg-primary/5 backdrop-blur-[1px]">
            <IconUpload className="h-10 w-10 text-primary" />
            <span className="text-base font-semibold text-primary">
              Drop to upload
            </span>
          </div>
        )}
        <section className="mb-5 space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <FolderChip
                active={activeFolderId === "all"}
                label="All assets"
                count={assets.length}
                onClick={() => setActiveFolderId("all")}
              />
              <FolderChip
                active={activeFolderId === null}
                label="Unfiled"
                count={unfiledCount}
                onClick={() => setActiveFolderId(null)}
              />
              {folders.map((folder) => (
                <FolderChip
                  key={folder.id}
                  active={activeFolderId === folder.id}
                  label={folder.title}
                  count={
                    assets.filter((asset) => asset.folderId === folder.id)
                      .length
                  }
                  onClick={() => setActiveFolderId(folder.id)}
                />
              ))}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative">
                <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search assets"
                  className="h-9 w-full pl-8 pr-8 sm:w-64"
                />
                {search && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setSearch("")}
                  >
                    <IconX className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <Select
                value={mediaFilter}
                onValueChange={(value) =>
                  setMediaFilter(value as "all" | "image" | "video")
                }
              >
                <SelectTrigger className="h-9 w-full sm:w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All media</SelectItem>
                  <SelectItem value="image">Images</SelectItem>
                  <SelectItem value="video">Videos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        {pendingVariants.length > 0 && (
          <section className="mb-6 rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">Live candidates</h3>
                <p className="text-xs text-muted-foreground">
                  These slots are written by the agent while generation runs.
                </p>
              </div>
              <LiveCandidatesActions
                slots={pendingVariants}
                libraryId={libraryId}
              />
            </div>
            <div className="max-h-[420px] overflow-y-auto pr-1">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {pendingVariants.map((slot: any) => (
                  <VariantCard
                    key={slot.slotId}
                    slot={slot}
                    libraryId={libraryId}
                    saving={savingCandidateKeys.has(candidateSaveKey(slot))}
                    onSave={() => {
                      void handleSaveCandidate(slot);
                    }}
                  />
                ))}
              </div>
            </div>
          </section>
        )}

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as LibraryTab)}
          className="space-y-4"
        >
          <TabsList>
            <TabsTrigger value="references">References</TabsTrigger>
            <TabsTrigger value="generated">Generated</TabsTrigger>
            <TabsTrigger value="runs">Runs</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="references">
            <AssetGrid
              assets={references}
              folders={folders}
              pendingUploads={pendingVisibleUploads}
              emptyTitle="Upload reference assets"
              emptyBody="Add images, clips, product shots, logos, and style references so the agent can match your brand."
              onEmptyClick={() => fileInputRef.current?.click()}
              onDrop={(files) => void upload(files)}
              selectedIds={selectedAssetIds}
              onSelectedIdsChange={setSelectedAssetIds}
              onOptimisticDelete={markAssetsOptimisticallyDeleted}
              onRestoreOptimisticDelete={restoreOptimisticallyDeletedAssets}
            />
          </TabsContent>

          <TabsContent value="generated">
            <AssetGrid
              assets={[...candidates, ...saved]}
              folders={folders}
              emptyTitle="Generate your first assets"
              emptyBody="Use the chat-driven generate flow to create image or video candidates, then save the ones that work."
              onEmptyClick={() => setGenerateOpen(true)}
              selectedIds={selectedAssetIds}
              onSelectedIdsChange={setSelectedAssetIds}
              onOptimisticDelete={markAssetsOptimisticallyDeleted}
              onRestoreOptimisticDelete={restoreOptimisticallyDeletedAssets}
            />
          </TabsContent>

          <TabsContent value="runs">
            {(data?.runs ?? []).length || generationSessions.length ? (
              <div className="space-y-3">
                {generationSessions.length ? (
                  <section className="rounded-lg border border-border bg-card p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold">
                          Handoff sessions
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Shared context for designers to continue a candidate
                          without the original chat thread.
                        </p>
                      </div>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {generationSessions.slice(0, 4).map((session: any) => (
                        <SessionCard
                          key={session.id}
                          session={session}
                          presets={generationPresets}
                          continuing={prepareSessionContinuation.isPending}
                          onContinue={() => continueSession(session.id)}
                        />
                      ))}
                    </div>
                  </section>
                ) : null}
                {(data?.runs ?? []).map((run: any) => (
                  <RunCard
                    key={run.id}
                    run={run}
                    outputAssets={assetById}
                    rerunning={
                      rerunGeneration.isPending || refreshGeneration.isPending
                    }
                    onCreateHandoff={() => createHandoffFromRun(run)}
                    onRerun={() =>
                      run.mediaType === "video"
                        ? refreshGeneration.mutate({ runId: run.id })
                        : rerunGeneration.mutate({
                            runId: run.id,
                            source: "ui",
                          })
                    }
                  />
                ))}
              </div>
            ) : (
              <div className="flex min-h-[260px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center">
                <IconMessageCircle className="h-10 w-10 text-muted-foreground" />
                <h3 className="mt-4 text-base font-semibold">No runs yet</h3>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                  Generate from this brand kit to capture prompt, output,
                  references, and settings.
                </p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="settings">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-4 rounded-lg border border-border p-4">
                <Label>Style description</Label>
                <Textarea
                  value={styleDescriptionDraft}
                  onChange={(event) =>
                    setStyleDescriptionDraft(event.target.value)
                  }
                  onBlur={() =>
                    updateLibrary.mutate({
                      id: library.id,
                      styleBrief: {
                        ...library.styleBrief,
                        description: styleDescriptionDraft,
                      },
                    })
                  }
                  className="min-h-40"
                />
                <Separator />
                <Label>Custom instructions</Label>
                <Textarea
                  value={customInstructionsDraft}
                  onChange={(event) =>
                    setCustomInstructionsDraft(event.target.value)
                  }
                  onBlur={() =>
                    updateLibrary.mutate({
                      id: library.id,
                      customInstructions: customInstructionsDraft,
                    })
                  }
                  placeholder="Preferences the agent should apply whenever it uses this brand kit."
                  className="min-h-28"
                />
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Palette</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(library.styleBrief?.palette ?? []).map(
                        (color: string) => (
                          <span
                            key={color}
                            className="h-7 w-7 rounded-md border border-border"
                            style={{ backgroundColor: color }}
                            title={color}
                          />
                        ),
                      )}
                    </div>
                    <Input
                      value={paletteDraft}
                      onChange={(event) => setPaletteDraft(event.target.value)}
                      onBlur={() => {
                        const palette = parsePaletteDraft(paletteDraft);
                        setPaletteDraft(palette.join(", "));
                        updateLibrary.mutate({
                          id: library.id,
                          styleBrief: {
                            ...library.styleBrief,
                            palette,
                          },
                        });
                      }}
                      placeholder="#111827, #f8fafc, #2563eb"
                      className="mt-3 h-9 max-w-md text-xs"
                    />
                  </div>
                  <Button variant="outline" onClick={analyzeBrand}>
                    {library.settings?.brandAnalysis?.analyzedAt
                      ? "Refresh brand"
                      : "Analyze brand"}
                  </Button>
                </div>
              </div>
              <div className="space-y-4">
                <GenerationPresetsPanel
                  libraryId={libraryId}
                  presets={generationPresets}
                />
                <div className="rounded-lg border border-border p-4">
                  <h3 className="text-sm font-semibold">Agent usage</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Other agents can call Assets over A2A with this brand kit
                    ID.
                  </p>
                  <code className="mt-3 block rounded-md bg-muted p-3 text-xs">
                    {library.id}
                  </code>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

type GenerateOptions = {
  mediaType: "image" | "video";
  presetId?: string;
  count: number;
  aspectRatio: string;
  imageSize: string;
  durationSeconds: number;
  resolution: string;
  model: string;
  category: string;
  includeLogo: boolean;
};

type PendingUpload = {
  id: string;
  name: string;
  mediaType: "image" | "video";
  folderId: string | null;
  status: "uploading" | "checking";
};

type LibraryTab = "references" | "generated" | "runs" | "settings";

function RunCard({
  run,
  outputAssets,
  onRerun,
  onCreateHandoff,
  rerunning,
}: {
  run: any;
  outputAssets?: Map<string, any>;
  onRerun: () => void;
  onCreateHandoff: () => void;
  rerunning?: boolean;
}) {
  const settings = (run.settingsUsed ?? {}) as Record<string, unknown>;
  const referenceSelection = (run.referenceSelection ?? {}) as Record<
    string,
    unknown
  >;
  const selectedReferenceIds = Array.isArray(
    referenceSelection.selectedAssetIds,
  )
    ? referenceSelection.selectedAssetIds.filter(
        (id): id is string => typeof id === "string",
      )
    : Array.isArray(run.referenceAssetIds)
      ? run.referenceAssetIds
      : [];
  const outputIds = Array.isArray(run.output?.assetIds)
    ? run.output.assetIds.filter(
        (id: unknown): id is string => typeof id === "string",
      )
    : run.output?.assetId
      ? [run.output.assetId]
      : [];
  const provider = run.output?.provider || run.metadata?.provider;
  const prompt = run.originalPrompt || run.prompt || "";
  const mediaType = run.mediaType || run.metadata?.mediaType || "image";
  const categories = Array.isArray(settings.categories)
    ? settings.categories.filter(
        (category): category is string => typeof category === "string",
      )
    : [];

  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={run.status === "completed" ? "secondary" : "outline"}
            >
              {run.status}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {run.model} · {run.aspectRatio} ·{" "}
              {mediaType === "video"
                ? `${run.durationSeconds || settings.durationSeconds || "?"}s · ${run.resolution || settings.resolution || run.imageSize}`
                : run.imageSize}
            </span>
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground">
              Prompt
            </div>
            <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-foreground">
              {prompt}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {outputIds.length ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={onCreateHandoff}
            >
              <IconMessageCircle className="h-4 w-4" />
              Handoff
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={rerunning}
            onClick={onRerun}
          >
            <IconRefresh className="h-4 w-4" />
            {mediaType === "video" && run.status !== "completed"
              ? "Refresh"
              : "Rerun this"}
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <RunFact label="Model" value={String(settings.model ?? run.model)} />
        <RunFact
          label="Aspect"
          value={String(settings.aspectRatio ?? run.aspectRatio)}
        />
        <RunFact
          label="Size"
          value={
            mediaType === "video"
              ? `${String(settings.durationSeconds ?? run.durationSeconds ?? "?")}s ${String(settings.resolution ?? run.resolution ?? run.imageSize)}`
              : String(settings.imageSize ?? run.imageSize)
          }
        />
        <RunFact
          label="Refs"
          value={`${selectedReferenceIds.length} ${String(referenceSelection.mode ?? "selected")}`}
        />
        <RunFact
          label="Grounding"
          value={String(settings.groundingMode ?? run.groundingMode)}
        />
        <RunFact
          label="Categories"
          value={categories.length ? categories.join(", ") : "auto"}
        />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="text-xs font-medium text-muted-foreground">
            Output
          </div>
          {outputIds.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {outputIds.map((assetId) => {
                const outputAsset = outputAssets?.get(assetId);
                return (
                  <Button
                    key={assetId}
                    asChild
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                  >
                    <Link to={`/asset/${assetId}`}>
                      {assetLineageLabel(outputAsset) ?? shortId(assetId)}
                    </Link>
                  </Button>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              {run.error || "No output captured yet."}
            </p>
          )}
          {provider ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Provider: {String(provider)}
            </p>
          ) : null}
        </div>

        <div className="rounded-md border bg-muted/20 p-3">
          <div className="text-xs font-medium text-muted-foreground">
            References
          </div>
          <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
            {selectedReferenceIds.length
              ? selectedReferenceIds.map(shortId).join(", ")
              : "None selected"}
          </p>
        </div>
      </div>

      {run.compiledPrompt ? (
        <details className="mt-3 rounded-md border bg-background">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
            Compiled prompt
          </summary>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {run.compiledPrompt}
          </pre>
        </details>
      ) : null}
    </article>
  );
}

function RunFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <div className="text-[11px] font-medium uppercase text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate text-xs text-foreground">{value}</div>
    </div>
  );
}

function assetLineageLabel(asset: any): string | null {
  return typeof asset?.lineage?.label === "string" && asset.lineage.label
    ? asset.lineage.label
    : null;
}

function assetDisplayTitle(asset: any): string {
  return (
    assetLineageLabel(asset) ||
    asset.title ||
    assetCategoryLabel(asset) ||
    asset.status ||
    "Asset"
  );
}

// Content-only references are images attached as subject/content for a single
// request. They are not part of the curated brand kit, so they are kept out of
// the References grid (matching how list-libraries excludes them from counts).
function isContentOnlyReference(asset: any): boolean {
  return (
    asset?.role === "subject_reference" || asset?.metadata?.intent === "subject"
  );
}

function assetCategoryLabel(asset: any): string | null {
  if (isContentOnlyReference(asset)) {
    return "content only";
  }
  const category = asset?.metadata?.category;
  if (typeof category !== "string") return null;
  if (category === "style-only") return "style reference";
  return category.replace(/-/g, " ");
}

function assetLineageSourceText(asset: any): string | null {
  const lineage = asset?.lineage;
  return lineage?.kind === "variation" && lineage.sourceLabel
    ? `from ${lineage.sourceLabel}`
    : null;
}

function shortId(id: string) {
  return id.length > 12 ? `${id.slice(0, 6)}...${id.slice(-4)}` : id;
}

function outputAssetIds(run: any): string[] {
  if (Array.isArray(run.output?.assetIds)) {
    return run.output.assetIds.filter(
      (id: unknown): id is string => typeof id === "string",
    );
  }
  return run.output?.assetId ? [run.output.assetId] : [];
}

function SessionCard({
  session,
  presets,
  continuing,
  onContinue,
}: {
  session: any;
  presets: any[];
  continuing?: boolean;
  onContinue: () => void;
}) {
  const preset = presets.find((item) => item.id === session.presetId);
  const sessionItems = Array.isArray(session.items) ? session.items : [];
  const assetItems = sessionItems.filter((item: any) => item.assetId);
  return (
    <article className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate text-sm font-semibold">{session.title}</h4>
            <Badge variant="outline">{session.status}</Badge>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {session.feedbackSummary || session.brief || "No feedback yet."}
          </p>
        </div>
        <Button
          size="sm"
          className="shrink-0 gap-2"
          disabled={continuing}
          onClick={onContinue}
        >
          {continuing ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <IconMessageCircle className="h-4 w-4" />
          )}
          Continue
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
        {preset ? <Badge variant="secondary">{preset.title}</Badge> : null}
        {assetItems.slice(0, 4).map((item: any) => (
          <Badge
            key={item.id}
            variant={
              item.assetId === session.activeAssetId ? "secondary" : "outline"
            }
          >
            {item.assetId === session.activeAssetId
              ? `${item.label} active`
              : item.label}
          </Badge>
        ))}
        {assetItems.length > 4 ? (
          <Badge variant="outline">+{assetItems.length - 4}</Badge>
        ) : null}
        {!assetItems.length && session.activeAssetId ? (
          <Badge variant="outline">
            active {shortId(session.activeAssetId)}
          </Badge>
        ) : null}
      </div>
    </article>
  );
}

function GeneratePopover({
  open,
  onOpenChange,
  onSubmit,
  hasLogo,
  presets,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (prompt: string, options: GenerateOptions) => void;
  hasLogo: boolean;
  presets: any[];
}) {
  const [prompt, setPrompt] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [presetId, setPresetId] = useState("none");
  const [count, setCount] = useState(3);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [imageSize, setImageSize] = useState("2K");
  const [durationSeconds, setDurationSeconds] = useState(8);
  const [resolution, setResolution] = useState("720p");
  const [model, setModel] = useState("gemini-3.1-flash-image");
  const [category, setCategory] = useState("hero");
  const [includeLogo, setIncludeLogo] = useState(false);
  const selectedPreset = presets.find((preset) => preset.id === presetId);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button className="gap-2">
          <IconMessageCircle className="h-4 w-4" />
          Generate
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[420px] max-w-[calc(100vw-2rem)]"
      >
        <div className="space-y-4">
          <div>
            <div className="text-sm font-semibold">Generate with chat</div>
          </div>
          {presets.length ? (
            <Select
              value={presetId}
              onValueChange={(value) => {
                setPresetId(value);
                const preset = presets.find((item) => item.id === value);
                if (!preset) return;
                setMediaType(preset.mediaType === "video" ? "video" : "image");
                setAspectRatio(preset.aspectRatio || "16:9");
                setImageSize(preset.imageSize || "2K");
                setModel(preset.model || "gemini-3.1-flash-image");
                setCategory(preset.category || "hero");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Preset" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No preset</SelectItem>
                {presets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {selectedPreset?.textPolicy ? (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              {selectedPreset.textPolicy}
            </p>
          ) : null}
          <Select
            value={mediaType}
            onValueChange={(value) => {
              const next = value as "image" | "video";
              setMediaType(next);
              setModel(
                next === "video"
                  ? "veo-3.1-generate-preview"
                  : "gemini-3.1-flash-image",
              );
              setCategory(next === "video" ? "video" : "hero");
              setAspectRatio(next === "video" ? "16:9" : aspectRatio);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="image">Image candidates</SelectItem>
              <SelectItem value="video">Video candidate</SelectItem>
            </SelectContent>
          </Select>
          <Textarea
            autoGrow
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={
              mediaType === "video"
                ? "Eight-second product reveal with slow camera push-in"
                : "Blog hero for an article about cold-start latency"
            }
            className="min-h-28 max-h-48 resize-none overflow-y-auto"
          />
          <div className="grid grid-cols-2 gap-3">
            {mediaType === "image" ? (
              <Select
                value={String(count)}
                onValueChange={(v) => setCount(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} variants
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Select
                value={String(durationSeconds)}
                onValueChange={(v) => setDurationSeconds(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VIDEO_DURATIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}s
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={aspectRatio} onValueChange={setAspectRatio}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(mediaType === "video"
                  ? VIDEO_ASPECT_RATIOS
                  : ASPECT_RATIOS
                ).map((ratio) => (
                  <SelectItem key={ratio} value={ratio}>
                    {ratio}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {mediaType === "image" ? (
              <Select value={imageSize} onValueChange={setImageSize}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMAGE_SIZES.map((size) => (
                    <SelectItem key={size} value={size}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Select value={resolution} onValueChange={setResolution}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VIDEO_RESOLUTIONS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMAGE_CATEGORIES.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(mediaType === "video" ? VIDEO_MODELS : IMAGE_MODELS).map(
                (item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
          {mediaType === "image" && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={includeLogo}
                disabled={!hasLogo}
                onCheckedChange={(checked) => setIncludeLogo(checked === true)}
              />
              Composite canonical logo
            </label>
          )}
          <Button
            className="w-full"
            disabled={!prompt.trim()}
            onClick={() =>
              onSubmit(prompt, {
                mediaType,
                presetId: presetId === "none" ? undefined : presetId,
                count,
                aspectRatio,
                imageSize,
                durationSeconds,
                resolution,
                model,
                category,
                includeLogo,
              })
            }
          >
            Open chat
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function GenerationPresetsPanel({
  libraryId,
  presets,
}: {
  libraryId: string;
  presets: any[];
}) {
  const createPreset = useActionMutation("create-generation-preset");
  const deletePreset = useActionMutation("delete-generation-preset");
  const [open, setOpen] = useState(false);
  const [confirmPresetId, setConfirmPresetId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("social");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [promptTemplate, setPromptTemplate] = useState("");
  const [textPolicy, setTextPolicy] = useState(
    "Prefer no embedded text. Keep any requested text short and readable.",
  );

  function reset() {
    setTitle("");
    setCategory("social");
    setAspectRatio("1:1");
    setPromptTemplate("");
    setTextPolicy(
      "Prefer no embedded text. Keep any requested text short and readable.",
    );
  }

  function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    createPreset.mutate(
      {
        libraryId,
        title: trimmed,
        category,
        aspectRatio,
        imageSize: "2K",
        promptTemplate: promptTemplate.trim() || undefined,
        textPolicy,
        referencePolicy: "auto",
      },
      {
        onSuccess: () => {
          toast.success("Generation preset created.");
          reset();
          setOpen(false);
        },
        onError: (error: Error) => {
          toast.error(error.message || "Could not create preset.");
        },
      },
    );
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Generation presets</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Reusable deliverable rules for social images, heroes, and diagrams.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          New
        </Button>
      </div>
      <div className="mt-3 space-y-2">
        {presets.slice(0, 5).map((preset) => (
          <div
            key={preset.id}
            className="flex items-start justify-between gap-3 rounded-md border border-border bg-background p-3"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium">
                  {preset.title}
                </span>
                <Badge variant="outline">{preset.aspectRatio}</Badge>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {preset.textPolicy || preset.description || preset.category}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
              aria-label={`Delete ${preset.title}`}
              onClick={() => setConfirmPresetId(preset.id)}
            >
              <IconTrash className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {!presets.length ? (
          <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
            No presets yet.
          </p>
        ) : null}
      </div>

      <AlertDialog
        open={confirmPresetId !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setConfirmPresetId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete generation preset?</AlertDialogTitle>
            <AlertDialogDescription>
              Existing runs keep their captured prompt and settings. New
              generations will no longer offer this preset.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!confirmPresetId || deletePreset.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (!confirmPresetId) return;
                deletePreset.mutate(
                  { id: confirmPresetId },
                  {
                    onSuccess: () => {
                      setConfirmPresetId(null);
                      toast.success("Generation preset deleted.");
                    },
                    onError: (error: Error) => {
                      toast.error(error.message || "Could not delete preset.");
                    },
                  },
                );
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New generation preset</DialogTitle>
            <DialogDescription>
              Save the output format, aspect ratio, and text rules for repeated
              image work.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="preset-title">Name</Label>
              <Input
                id="preset-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="LinkedIn announcement"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {IMAGE_CATEGORIES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Aspect ratio</Label>
                <Select value={aspectRatio} onValueChange={setAspectRatio}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASPECT_RATIOS.map((ratio) => (
                      <SelectItem key={ratio} value={ratio}>
                        {ratio}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="preset-template">Prompt template</Label>
              <Textarea
                id="preset-template"
                value={promptTemplate}
                onChange={(event) => setPromptTemplate(event.target.value)}
                placeholder="Create a social post visual about {{prompt}}..."
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="preset-text-policy">Text policy</Label>
              <Textarea
                id="preset-text-policy"
                value={textPolicy}
                onChange={(event) => setTextPolicy(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!title.trim()} onClick={submit}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FolderChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex h-8 items-center gap-2 rounded-md border px-3 text-sm transition",
        active
          ? "border-foreground/20 bg-foreground text-background"
          : "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      ].join(" ")}
    >
      <IconFolder className="h-3.5 w-3.5" />
      <span className="max-w-36 truncate">{label}</span>
      <span className={active ? "text-background/70" : "text-muted-foreground"}>
        {count}
      </span>
    </button>
  );
}

function PendingUploadCard({ upload }: { upload: PendingUpload }) {
  const isChecking = upload.status === "checking";
  return (
    <div className="overflow-hidden rounded-lg border border-dashed border-border bg-card">
      <div className="flex aspect-[4/3] items-center justify-center bg-muted/30">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Spinner className="h-5 w-5" />
          <span className="text-xs font-medium">
            {isChecking ? "Checking upload" : "Uploading"}
          </span>
        </div>
      </div>
      <div className="space-y-2 p-3">
        <div className="flex items-center gap-2 truncate text-xs font-medium">
          {upload.mediaType === "video" ? (
            <IconVideo className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <IconPhoto className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{upload.name}</span>
        </div>
        <Badge variant="outline">
          {isChecking ? "verifying" : "uploading"}
        </Badge>
      </div>
    </div>
  );
}

function AssetPreview({ asset }: { asset: any }) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const sources = assetPreviewSources(asset, "thumbnail");
  const sourcesKey = sources.join("\n");

  useEffect(() => {
    setSourceIndex(0);
    setUnavailable(false);
  }, [sourcesKey]);

  if (asset.mediaType === "video" || asset.mimeType?.startsWith("video/")) {
    return (
      <div className="relative h-full w-full bg-muted">
        <video
          src={assetMediaUrl(asset.previewUrl)}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
        />
        <div className="absolute bottom-2 left-2 rounded-md bg-background/90 px-2 py-1 text-[11px] font-medium text-foreground shadow-sm">
          Video
        </div>
      </div>
    );
  }
  const src = sources[sourceIndex];
  if (unavailable || !src) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted/40 text-muted-foreground">
        <IconPhoto className="h-6 w-6" />
        <span className="px-3 text-center text-xs font-medium">
          Preview unavailable
        </span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={asset.altText || asset.title || ""}
      className="h-full w-full object-cover transition group-hover:scale-[1.02]"
      onError={() => {
        const nextIndex = sourceIndex + 1;
        if (nextIndex < sources.length) {
          setSourceIndex(nextIndex);
        } else {
          setUnavailable(true);
        }
      }}
    />
  );
}

function CreateFolderDialog({
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (title: string) => void | Promise<void>;
  pending?: boolean;
}) {
  const [title, setTitle] = useState("");
  async function submit() {
    const trimmed = title.trim();
    if (!trimmed || pending) return;
    try {
      await onSubmit(trimmed);
      setTitle("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create folder",
      );
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>
            Group uploaded and generated assets for a campaign, channel, or
            reusable collection.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="folder-title">Name</Label>
          <Input
            id="folder-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && title.trim()) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="Campaign launch"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || pending}
            onClick={() => {
              void submit();
            }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssetGrid({
  assets,
  folders,
  pendingUploads = [],
  emptyTitle,
  emptyBody,
  onEmptyClick,
  onDrop,
  selectedIds,
  onSelectedIdsChange,
  onOptimisticDelete,
  onRestoreOptimisticDelete,
}: {
  assets: any[];
  folders: any[];
  pendingUploads?: PendingUpload[];
  emptyTitle: string;
  emptyBody: string;
  onEmptyClick: () => void;
  onDrop?: (files: FileList) => void;
  selectedIds: Set<string>;
  onSelectedIdsChange: Dispatch<SetStateAction<Set<string>>>;
  onOptimisticDelete?: (ids: string[]) => void;
  onRestoreOptimisticDelete?: (ids: string[]) => void;
}) {
  const deleteAsset = useActionMutation("delete-asset");
  const deleteAssets = useActionMutation("delete-assets");
  const updateAsset = useActionMutation("update-asset");
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[]>([]);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set());
  const selectedAssets = assets.filter((asset) => selectedIds.has(asset.id));
  const selectedCount = selectedAssets.length;
  const allSelected = assets.length > 0 && selectedCount === assets.length;
  const pendingDeleteCount = deletingIds.size;
  const deleting =
    deleteAsset.isPending || deleteAssets.isPending || pendingDeleteCount > 0;

  function toggleAsset(assetId: string, checked: boolean) {
    onSelectedIdsChange((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(assetId);
      } else {
        next.delete(assetId);
      }
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    onSelectedIdsChange(
      checked ? new Set(assets.map((asset) => asset.id)) : new Set(),
    );
  }

  function confirmDelete(ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length) setConfirmDeleteIds(uniqueIds);
  }

  function markDeleting(ids: string[]) {
    setDeletingIds((current) => {
      const next = new Set(current);
      for (const id of ids) next.add(id);
      return next;
    });
    onSelectedIdsChange((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });
    onOptimisticDelete?.(ids);
  }

  function finishDeleting(ids: string[]) {
    setDeletingIds((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });
  }

  function restoreAfterDeleteError(ids: string[]) {
    finishDeleting(ids);
    onRestoreOptimisticDelete?.(ids);
    onSelectedIdsChange((current) => {
      const next = new Set(current);
      for (const id of ids) next.add(id);
      return next;
    });
  }

  function handleDeleteConfirmed() {
    if (!confirmDeleteIds.length || deleting) return;
    if (confirmDeleteIds.length === 1) {
      const [id] = confirmDeleteIds;
      const ids = [id];
      markDeleting(ids);
      setConfirmDeleteIds([]);
      deleteAsset.mutate(
        { id },
        {
          onSuccess: () => {
            finishDeleting(ids);
            toast.success("Deleted asset.");
          },
          onError: (error) => {
            restoreAfterDeleteError(ids);
            toast.error(error.message || "Could not delete asset.");
          },
        },
      );
      return;
    }
    const ids = [...confirmDeleteIds];
    markDeleting(ids);
    setConfirmDeleteIds([]);
    deleteAssets.mutate(
      { ids },
      {
        onSuccess: (result: any) => {
          finishDeleting(ids);
          const deletedIds = new Set(ids);
          const count = Number(result?.deletedCount ?? deletedIds.size);
          toast.success(`Deleted ${count} asset${count === 1 ? "" : "s"}.`);
        },
        onError: (error) => {
          restoreAfterDeleteError(ids);
          toast.error(error.message || "Could not delete selected assets.");
        },
      },
    );
  }

  if (!assets.length && !pendingUploads.length && pendingDeleteCount === 0) {
    return (
      <button
        onClick={onEmptyClick}
        onDragOver={(e) => {
          if (onDrop && e.dataTransfer.types.includes("Files"))
            e.preventDefault();
        }}
        onDrop={(e) => {
          if (!onDrop) return;
          e.preventDefault();
          e.stopPropagation();
          onDrop(e.dataTransfer.files);
        }}
        className="flex min-h-[320px] w-full flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center"
      >
        <IconPhotoPlus className="h-10 w-10 text-muted-foreground" />
        <span className="mt-4 text-base font-semibold">{emptyTitle}</span>
        <span className="mt-2 max-w-md text-sm text-muted-foreground">
          {emptyBody}
        </span>
      </button>
    );
  }

  return (
    <>
      <AlertDialog
        open={confirmDeleteIds.length > 0}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteIds([]);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDeleteIds.length > 1
                ? `Delete ${confirmDeleteIds.length} assets?`
                : "Delete asset?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDeleteIds.length > 1
                ? "This removes the selected assets from the brand kit. Existing exports that already use these URLs may stop rendering."
                : "This removes the asset from the brand kit. Existing exports that already use this URL may stop rendering."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!confirmDeleteIds.length || deleting}
              onClick={(event) => {
                event.preventDefault();
                handleDeleteConfirmed();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {assets.length > 0 || pendingDeleteCount > 0 ? (
        <div className="mb-3 flex min-h-10 flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
          {pendingDeleteCount > 0 ? (
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <Spinner className="h-4 w-4" />
              <span className="truncate">
                Deleting {pendingDeleteCount} asset
                {pendingDeleteCount === 1 ? "" : "s"}...
              </span>
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(checked) => toggleAll(checked === true)}
                aria-label="Select all assets in this view"
              />
              <span className="truncate">
                {selectedCount > 0
                  ? `${selectedCount} selected`
                  : `${assets.length} asset${assets.length === 1 ? "" : "s"}`}
              </span>
            </div>
          )}
          {selectedCount > 0 && pendingDeleteCount === 0 ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onSelectedIdsChange(new Set())}
              >
                Clear
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() =>
                  confirmDelete(selectedAssets.map((asset) => asset.id))
                }
                disabled={deleting}
              >
                {deleting ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <IconTrash className="h-4 w-4" />
                )}
                Delete
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {assets.length || pendingUploads.length ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {pendingUploads.map((upload) => (
            <PendingUploadCard key={upload.id} upload={upload} />
          ))}
          {assets.map((asset) => {
            const displayTitle = assetDisplayTitle(asset);
            const sourceText = assetLineageSourceText(asset);
            return (
              <div
                key={asset.id}
                className={[
                  "group relative overflow-hidden rounded-lg border bg-card transition",
                  selectedIds.has(asset.id)
                    ? "border-primary ring-2 ring-primary/25"
                    : "border-border",
                ].join(" ")}
              >
                <div className="absolute left-2 top-2 z-10">
                  <Checkbox
                    checked={selectedIds.has(asset.id)}
                    onCheckedChange={(checked) =>
                      toggleAsset(asset.id, checked === true)
                    }
                    aria-label={`Select ${displayTitle}`}
                    className={[
                      "border-background bg-background/90 shadow-sm opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100",
                      selectedIds.has(asset.id) ? "sm:opacity-100" : "",
                    ].join(" ")}
                  />
                </div>
                <div className="absolute right-2 top-2 z-10">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        className="h-8 w-8 shadow-sm opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 data-[state=open]:opacity-100"
                        aria-label="Asset actions"
                      >
                        <IconDotsVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link to={`/asset/${asset.id}`}>View details</Link>
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <IconFolder className="mr-2 h-4 w-4 shrink-0" />
                          Move to
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuItem
                            onSelect={() =>
                              updateAsset.mutate({
                                id: asset.id,
                                folderId: null,
                              })
                            }
                          >
                            Unfiled
                          </DropdownMenuItem>
                          {folders.map((folder) => (
                            <DropdownMenuItem
                              key={folder.id}
                              onSelect={() =>
                                updateAsset.mutate({
                                  id: asset.id,
                                  folderId: folder.id,
                                })
                              }
                            >
                              {folder.title}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                        onSelect={() => confirmDelete([asset.id])}
                      >
                        <IconTrash className="mr-2 h-4 w-4 shrink-0" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <Link to={`/asset/${asset.id}`} className="block outline-none">
                  <div className="aspect-[4/3] bg-muted">
                    <AssetPreview asset={asset} />
                  </div>
                  <div className="space-y-2 p-3">
                    <div className="flex items-center gap-2 truncate text-xs font-medium">
                      {asset.mediaType === "video" ? (
                        <IconVideo className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <IconPhoto className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">{displayTitle}</span>
                    </div>
                    {sourceText ? (
                      <div className="truncate text-[11px] text-muted-foreground">
                        {sourceText}
                      </div>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{asset.status}</Badge>
                      {assetCategoryLabel(asset) && (
                        <Badge variant="outline">
                          {assetCategoryLabel(asset)}
                        </Badge>
                      )}
                    </div>
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-[320px] w-full flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center">
          <Spinner className="h-8 w-8 text-muted-foreground" />
          <span className="mt-4 text-base font-semibold">
            Deleting selected assets...
          </span>
        </div>
      )}
    </>
  );
}

function VariantCard({
  slot,
  libraryId,
  onSave,
  saving = false,
}: {
  slot: any;
  libraryId: string;
  onSave: () => void;
  saving?: boolean;
}) {
  const dismissSlot = useActionMutation("dismiss-variant-slots");
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [previewUnavailable, setPreviewUnavailable] = useState(false);
  const previewSources = assetPreviewSources(slot, "thumbnail");
  const previewSourcesKey = previewSources.join("\n");
  const isFailed = slot.status === "failed";
  const label = isFailed ? "Dismiss" : "Delete";
  const busy = saving || dismissSlot.isPending;
  const previewSrc = previewSources[sourceIndex];

  useEffect(() => {
    setSourceIndex(0);
    setPreviewUnavailable(false);
  }, [previewSourcesKey]);

  return (
    <div
      className="group relative overflow-hidden rounded-lg border border-border bg-background"
      aria-busy={busy}
    >
      <div className="absolute right-2 top-2 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-8 w-8 shadow-sm opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 data-[state=open]:opacity-100"
              aria-label="Candidate actions"
              disabled={busy}
            >
              <IconDotsVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive focus:bg-destructive/10 focus:text-destructive"
              onSelect={(event) => {
                event.preventDefault();
                setConfirmOpen(true);
              }}
            >
              <IconTrash className="mr-2 h-4 w-4 shrink-0" />
              {label}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!dismissSlot.isPending) setConfirmOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isFailed ? "Dismiss this slot?" : "Delete candidate?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isFailed
                ? "Removes this failed slot from the live candidates panel."
                : "Removes this candidate from the brand kit and clears its slot."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dismissSlot.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={dismissSlot.isPending}
              onClick={(event) => {
                event.preventDefault();
                dismissSlot.mutate(
                  { slotId: slot.slotId },
                  {
                    onSuccess: () => {
                      removeVariantSlotFromCache(queryClient, slot);
                      removeAssetsFromLibraryCache(queryClient, libraryId, [
                        slot.assetId,
                      ]);
                      setConfirmOpen(false);
                      void queryClient.invalidateQueries({
                        queryKey: ["app-state", "asset-variants"],
                        refetchType: "active",
                      });
                    },
                    onError: (error) =>
                      toast.error(
                        error.message || "Could not clear candidate.",
                      ),
                  },
                );
              }}
            >
              {dismissSlot.isPending ? (
                <>
                  <Spinner className="h-4 w-4" />
                  {isFailed ? "Dismissing..." : "Deleting..."}
                </>
              ) : (
                label
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex aspect-[4/3] items-center justify-center bg-muted">
        {previewSrc && !previewUnavailable ? (
          <img
            src={previewSrc}
            alt=""
            className="h-full w-full object-cover"
            onError={() => {
              const nextIndex = sourceIndex + 1;
              if (nextIndex < previewSources.length) {
                setSourceIndex(nextIndex);
              } else {
                setPreviewUnavailable(true);
              }
            }}
          />
        ) : isFailed ? (
          <div className="p-4 text-center text-xs text-destructive">
            {slot.error}
          </div>
        ) : previewUnavailable ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            Preview unavailable
          </div>
        ) : (
          <IconPhoto className="h-8 w-8 animate-pulse text-muted-foreground" />
        )}
      </div>
      <div className="flex items-center justify-between gap-2 p-3">
        <Badge variant={slot.status === "ready" ? "secondary" : "outline"}>
          {slot.status}
        </Badge>
        {slot.status === "ready" && (
          <Button size="sm" className="w-24" onClick={onSave} disabled={busy}>
            {saving ? (
              <>
                <Spinner className="h-4 w-4" />
                Saving...
              </>
            ) : (
              "Save"
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

function LiveCandidatesActions({
  slots,
  libraryId,
}: {
  slots: any[];
  libraryId: string;
}) {
  const dismissSlots = useActionMutation("dismiss-variant-slots");
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<"failed" | "all" | null>(null);
  const failedCount = slots.filter((s) => s.status === "failed").length;
  const hasFailed = failedCount > 0;
  const isClearing = dismissSlots.isPending;
  const actionLabel = pending === "failed" ? "Dismiss failed" : "Clear all";
  const busyLabel = pending === "failed" ? "Dismissing..." : "Clearing...";

  return (
    <>
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !isClearing) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending === "failed"
                ? `Dismiss ${failedCount} failed ${failedCount === 1 ? "slot" : "slots"}?`
                : "Clear all live candidates?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending === "failed"
                ? "Removes every failed slot from the panel. Successful candidates stay."
                : "Clears the live candidates panel and deletes any unsaved candidate rows."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isClearing || pending === null}
              onClick={(event) => {
                event.preventDefault();
                const scope = pending;
                if (!scope) return;
                const removedAssetIds = slots
                  .filter((slot) => scope === "all" || slot.status === "failed")
                  .map((slot) => slot.assetId);
                dismissSlots.mutate(
                  { scope },
                  {
                    onSuccess: () => {
                      removeVariantSlotsByScopeFromCache(queryClient, scope);
                      removeAssetsFromLibraryCache(
                        queryClient,
                        libraryId,
                        removedAssetIds,
                      );
                      setPending(null);
                      void queryClient.invalidateQueries({
                        queryKey: ["app-state", "asset-variants"],
                        refetchType: "active",
                      });
                    },
                    onError: (error) =>
                      toast.error(
                        error.message || "Could not clear live candidates.",
                      ),
                  },
                );
              }}
            >
              {isClearing ? (
                <>
                  <Spinner className="h-4 w-4" />
                  {busyLabel}
                </>
              ) : (
                actionLabel
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            aria-label="Live candidates actions"
            disabled={isClearing}
          >
            <IconDotsVertical className="h-4 w-4" />
            Clear
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={!hasFailed || isClearing}
            onSelect={(event) => {
              event.preventDefault();
              setPending("failed");
            }}
          >
            <IconTrash className="mr-2 h-4 w-4 shrink-0" />
            Dismiss failed ({failedCount})
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            disabled={isClearing}
            onSelect={(event) => {
              event.preventDefault();
              setPending("all");
            }}
          >
            <IconTrash className="mr-2 h-4 w-4 shrink-0" />
            Clear all
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function useVariantState() {
  return useQuery({
    queryKey: ["app-state", "asset-variants"],
    queryFn: async () => {
      const res = await fetch(
        agentNativePath("/_agent-native/application-state/asset-variants"),
      );
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 1000,
  }) as any;
}
